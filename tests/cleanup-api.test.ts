import { describe, expect, it, vi } from 'vitest';
import { cleanupViaLocalAPI } from '../src/shared/local-api';
import { createServer } from '../src/server/app';
import { DEFAULT_CLEANUP_MODEL, MAX_CLEANUP_CHARS } from '../src/shared/cleanup';
const host = { host: '127.0.0.1:4318' };
const replyData = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"text":"Meet Thursday."}' }] } }] };
function setup(geminiFetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(replyData)))) {
  const server = createServer({ localMode: true, geminiApiKey: 'server-only-gemini-fixture', geminiFetcher });
  const headers = async () => ({ ...host, 'content-type': 'application/json', 'x-sargosh-token': (await server.inject({ method: 'GET', url: '/v1/local-session', headers: host })).json().token, 'x-sargosh-request-id': 'one' });
  return { server, geminiFetcher, headers };
}
describe('local cleanup API', () => {
  it('reports separate provider readiness without exposing credentials', async () => {
    const { server } = setup();
    try { expect((await server.inject({ method: 'GET', url: '/v1/readiness', headers: host })).json()).toEqual({ auth: false, stt: false, cleanup: true }); }
    finally { await server.close(); }
  });
  it('requires the local session token before any paid request', async () => {
    const { server, geminiFetcher } = setup();
    try {
      const response = await server.inject({ method: 'POST', url: '/v1/cleanup', headers: host, payload: { text: 'original', language: 'en' } });
      expect(response.statusCode).toBe(401); expect(geminiFetcher).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
  it('fails closed without a configured Gemini key', async () => {
    const server = createServer({ localMode: true, apiKey: 'deepgram-only-fixture' });
    try {
      const response = await server.inject({ method: 'POST', url: '/v1/cleanup', headers: host, payload: { text: 'original', language: 'en' } });
      expect(response.statusCode).toBe(503); expect(response.json().code).toBe('CLEANUP_NOT_CONFIGURED');
    } finally { await server.close(); }
  });
  it('returns structured cleanup and avoids duplicate charges for identical request IDs', async () => {
    const { server, geminiFetcher, headers } = setup();
    try {
      const request = { method: 'POST' as const, url: '/v1/cleanup', headers: await headers(), payload: { text: 'Meet Tuesday sorry Thursday', language: 'en' } };
      const first = await server.inject(request); const duplicate = await server.inject(request);
      expect(first.statusCode).toBe(200); expect(first.json()).toEqual({ text: 'Meet Thursday.', model: DEFAULT_CLEANUP_MODEL });
      expect(duplicate.json()).toEqual(first.json()); expect(geminiFetcher).toHaveBeenCalledOnce();
      expect(first.body).not.toContain('fixture');
      const mismatch = await server.inject({ ...request, payload: { text: 'different', language: 'en' } });
      expect(mismatch.statusCode).toBe(409); expect(geminiFetcher).toHaveBeenCalledOnce();
    } finally { await server.close(); }
  });
  it('validates text, language, request IDs, and extra fields before calling Gemini', async () => {
    const { server, geminiFetcher, headers } = setup();
    try {
      const base = await headers();
      for (const payload of [{ text: '', language: 'en' }, { text: 1, language: 'en' }, { text: 'text', language: 'xx' }, { text: 'x'.repeat(MAX_CLEANUP_CHARS + 1), language: 'en' }, { text: 'text', language: 'en', callback: 'https://untrusted.example' }]) {
        expect((await server.inject({ method: 'POST', url: '/v1/cleanup', headers: base, payload })).statusCode).toBe(400);
      }
      expect((await server.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...base, 'x-sargosh-request-id': 'invalid/id' }, payload: { text: 'text', language: 'en' } })).statusCode).toBe(400);
      expect(geminiFetcher).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
  it('rejects overly large JSON bodies', async () => {
    const { server, geminiFetcher, headers } = setup();
    try {
      const response = await server.inject({ method: 'POST', url: '/v1/cleanup', headers: await headers(), payload: { text: 'x'.repeat(128 * 1024), language: 'en' } });
      expect(response.statusCode).toBe(413); expect(response.json().code).toBe('TEXT_TOO_LARGE'); expect(geminiFetcher).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
  it('bounds cleanup attempt rates', async () => {
    const { server, geminiFetcher, headers } = setup();
    try {
      const base = await headers();
      for (let index = 0; index < 11; index++) {
        const response = await server.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...base, 'x-sargosh-request-id': String(index) }, payload: { text: 'text', language: 'en' } });
        expect(response.statusCode).toBe(index < 10 ? 200 : 429);
      }
      expect(geminiFetcher).toHaveBeenCalledTimes(10);
    } finally { await server.close(); }
  });
  it('allows only one in-flight cloud operation', async () => {
    let resolve!: (value: Response) => void;
    const geminiFetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(yes => { resolve = yes; }));
    const { server, headers } = setup(geminiFetcher);
    try {
      const base = await headers();
      const pending = server.inject({ method: 'POST', url: '/v1/cleanup', headers: base, payload: { text: 'text', language: 'en' } }).then(value => value);
      await vi.waitFor(() => expect(geminiFetcher).toHaveBeenCalledOnce());
      const next = await server.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...base, 'x-sargosh-request-id': 'two' }, payload: { text: 'another', language: 'en' } });
      expect(next.statusCode).toBe(429); resolve(new Response(JSON.stringify(replyData))); expect((await pending).statusCode).toBe(200);
    } finally { await server.close(); }
  });
  it('connects the shared client to the JSON cleanup route without sending audio again', async () => {
    const { server, geminiFetcher } = setup();
    const localFetch: typeof fetch = async (input, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const reply = await server.inject({ method: init?.method === 'POST' ? 'POST' : 'GET', url: String(input).replace(/^\/api/, ''), headers: { ...headers, ...host }, payload: init?.body as string | undefined });
      return new Response(reply.body, { status: reply.statusCode });
    };
    try {
      const result = await cleanupViaLocalAPI({ requestId: 'one', text: 'Meet Tuesday sorry Thursday', language: 'en' }, new AbortController().signal, '/api', localFetch);
      expect(result).toEqual({ text: 'Meet Thursday.', model: DEFAULT_CLEANUP_MODEL }); expect(geminiFetcher).toHaveBeenCalledOnce();
    } finally { await server.close(); }
  });

});
