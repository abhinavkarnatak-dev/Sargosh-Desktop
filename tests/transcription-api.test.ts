import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
import { MAX_AUDIO_BYTES } from '../src/shared/recording';
const host = { host: '127.0.0.1:4318' };
const data = { results: { channels: [{ alternatives: [{ transcript: 'A real response shape.', confidence: .9 }] }] }, metadata: { duration: 1 } };
function setup(fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(data)))) {
  const app = createServer({ localMode: true, apiKey: 'server-only-fixture-token', fetcher });
  const token = async () => (await app.inject({ method: 'GET', url: '/v1/local-session', headers: host })).json().token as string;
  return { app, fetcher, token };
}
describe('local transcription API', () => {
  it('requires an ephemeral local token before accepting paid audio calls', async () => {
    const { app, fetcher } = setup();
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/transcriptions?language=en', headers: { ...host, 'content-type': 'audio/webm', 'x-sargosh-request-id': 'one' }, payload: Buffer.from('audio') });
      expect(response.statusCode).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('rejects remote origins and untrusted host headers', async () => {
    const { app, fetcher } = setup();
    try {
      for (const headers of [{ ...host, origin: 'https://untrusted.example' }, { host: 'untrusted.example:4318' }]) {
        const response = await app.inject({ method: 'GET', url: '/v1/local-session', headers });
        expect(response.statusCode).toBe(403);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('returns transcription without exposing the backend key and caches exact duplicate requests', async () => {
    const { app, fetcher, token } = setup();
    try {
      const secret = await token();
      const request = { method: 'POST' as const, url: '/v1/transcriptions?language=hi', headers: { ...host, 'content-type': 'audio/webm;codecs=opus', 'x-sargosh-token': secret, 'x-sargosh-request-id': 'one' }, payload: Buffer.from('audio') };
      const first = await app.inject(request); const second = await app.inject(request);
      expect(first.statusCode).toBe(200); expect(second.json()).toEqual(first.json());
      expect(first.json()).toMatchObject({ text: 'A real response shape.', language: 'hi', model: 'nova-3' });
      expect(first.body).not.toContain('fixture-token'); expect(fetcher).toHaveBeenCalledOnce();
      const reused = await app.inject({ ...request, payload: Buffer.from('different') });
      expect(reused.statusCode).toBe(409); expect(fetcher).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
  it('validates language, non-empty content, request IDs, and audio type', async () => {
    const { app, fetcher, token } = setup();
    try {
      const headers = { ...host, 'content-type': 'audio/webm', 'x-sargosh-token': await token(), 'x-sargosh-request-id': 'one' };
      for (const request of [
        { url: '/v1/transcriptions?language=invalid', payload: Buffer.from('audio'), headers },
        { url: '/v1/transcriptions?language=en', payload: Buffer.from('audio'), headers: { ...headers, 'x-sargosh-request-id': 'invalid/id' } },
        { url: '/v1/transcriptions?language=en', payload: Buffer.alloc(0), headers },
        { url: '/v1/transcriptions?language=en', payload: '{}', headers: { ...headers, 'content-type': 'application/json' } }
      ]) expect((await app.inject({ method: 'POST', ...request })).statusCode).toBeGreaterThanOrEqual(400);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('enforces the upload size limit', async () => {
    const { app, fetcher, token } = setup();
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/transcriptions?language=en', headers: { ...host, 'content-type': 'audio/webm', 'x-sargosh-token': await token(), 'x-sargosh-request-id': 'one' }, payload: Buffer.alloc(MAX_AUDIO_BYTES + 1) });
      expect(response.statusCode).toBe(413); expect(response.json().code).toBe('AUDIO_TOO_LARGE'); expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('rejects a second in-flight transcription rather than starting parallel paid requests', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(yes => { resolve = yes; }));
    const { app, token } = setup(fetcher);
    try {
      const headers = { ...host, 'content-type': 'audio/webm', 'x-sargosh-token': await token(), 'x-sargosh-request-id': 'one' };
      const first = app.inject({ method: 'POST', url: '/v1/transcriptions?language=en', headers, payload: Buffer.from('audio') });
      const pending = first.then(response => response);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      const second = await app.inject({ method: 'POST', url: '/v1/transcriptions?language=en', headers: { ...headers, 'x-sargosh-request-id': 'two' }, payload: Buffer.from('audio') });
      expect(second.statusCode).toBe(429);
      resolve(new Response(JSON.stringify(data))); expect((await pending).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('rate limits local attempts even after successful requests', async () => {
    const { app, fetcher, token } = setup();
    try {
      const headers = { ...host, 'content-type': 'audio/webm', 'x-sargosh-token': await token() };
      for (let index = 0; index < 11; index++) {
        const response = await app.inject({ method: 'POST', url: '/v1/transcriptions?language=en', headers: { ...headers, 'x-sargosh-request-id': String(index) }, payload: Buffer.from('audio') });
        expect(response.statusCode).toBe(index < 10 ? 200 : 429);
      }
      expect(fetcher).toHaveBeenCalledTimes(10);
    } finally { await app.close(); }
  });
});
