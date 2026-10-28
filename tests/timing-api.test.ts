import { expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
import { transcribeViaLocalAPI, cleanupViaLocalAPI } from '../src/shared/local-api';
import { UsageError, type UsageStore } from '../src/server/usage';
import type { TimingEvent, TimingSink } from '../src/shared/timing';

const usage = { enabled: true };
function setup(output?: TimingSink, advance: (ms: number) => void = () => {}) {
  const events: TimingEvent[] = [];
  const store = {
    snapshot: vi.fn(async () => { advance(17); return usage; }), reserve: vi.fn(async (userId, requestId, kind) => { advance(23); return { userId, requestId, kind, leaseId: 'lease' }; }),
    dispatch: vi.fn(async () => { advance(29); }), finish: vi.fn(async () => { advance(37); }), release: vi.fn(async () => { advance(41); }),
  } as unknown as UsageStore;
  function response(value: unknown) {
    const result = new Response(JSON.stringify(value));
    const original = result.body!.getReader.bind(result.body!);
    vi.spyOn(result.body!, 'getReader').mockImplementation(() => {
      const reader = original(); const read = reader.read.bind(reader);
      reader.read = async () => { advance(7); return read(); };
      return reader;
    });
    return result;
  }
  const provider = vi.fn<typeof fetch>(async () => { advance(101); return response({ results: { channels: [{ alternatives: [{ transcript: 'private transcript', confidence: .9 }] }] }, metadata: { duration: 1 } }); });
  const cleanup = vi.fn<typeof fetch>(async () => { advance(203); return response({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ text: 'private cleaned text' }) }] } }] }); });
  const app = createServer({ hostedMode: true, allowedHosts: ['api.test'], verifySession: async token => { advance(11); return token === 'secret-token' ? 'private-user' : null; },
    usageStore: store, apiKey: 'private-deepgram-key', geminiApiKey: 'private-gemini-key', fetcher: provider, geminiFetcher: cleanup,
    normalize: async () => { advance(31); return { audio: Buffer.from('private audio'), durationSeconds: 1 }; }, timingSink: output ?? (event => events.push(event)) });
  const headers = { host: 'api.test', authorization: 'Bearer secret-token', 'x-sargosh-trace-id': 'dictation-123' };
  const submit = (requestId = 'stt-1', traceId = 'dictation-123') => app.inject({ method: 'POST', url: '/v1/transcriptions?language=en',
    headers: { ...headers, 'x-sargosh-trace-id': traceId, 'x-sargosh-request-id': requestId, 'content-type': 'audio/webm' }, payload: Buffer.from('private input audio') });
  return { app, events, store, provider, cleanup, submit, headers };
}

it('separates known authentication, database, normalization and provider delays without double counting', async () => {
  let clock = 0;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const x = setup(undefined, ms => { clock += ms; });
  try {
    expect((await x.submit()).statusCode).toBe(200);
    expect((await x.app.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...x.headers, 'x-sargosh-request-id': 'cleanup-1' },
      payload: { text: 'private transcript', language: 'en' } })).statusCode).toBe(200);
    const durations = (id: string) => Object.fromEntries(x.events.filter(event => event.requestId === id).map(event => [event.stage, event.durationMs]));
    expect(durations('stt-1')).toMatchObject({ 'server.auth': 11, 'server.body': 0, 'server.eligibility': 17, 'server.normalize': 31,
      'server.reserve': 23, 'server.dispatch': 29, 'provider.stt.headers': 101, 'provider.stt.body': 14, 'server.stt': 115, 'server.finish': 37, 'server.stt.total': 263 });
    expect(durations('cleanup-1')).toMatchObject({ 'server.auth': 11, 'server.body': 0, 'server.eligibility': 17,
      'server.reserve': 23, 'server.dispatch': 29, 'provider.cleanup.headers': 203, 'provider.cleanup.body': 14, 'server.cleanup': 217, 'server.finish': 37, 'server.cleanup.total': 334 });
  } finally { await x.app.close(); now.mockRestore(); }
});

it('records rejected authentication and malformed request bodies without calling providers', async () => {
  const x = setup();
  try {
    expect((await x.app.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...x.headers, authorization: 'Bearer wrong', 'x-sargosh-request-id': 'denied' }, payload: {} })).statusCode).toBe(401);
    expect(x.events.filter(event => event.requestId === 'denied').map(event => event.stage)).toEqual(['server.auth', 'server.cleanup.total']);
    const malformed = await x.app.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...x.headers, 'content-type': 'application/json', 'x-sargosh-request-id': 'malformed' }, payload: '{invalid' });
    expect(malformed.statusCode).toBeGreaterThanOrEqual(400);
    expect(x.events).toContainEqual(expect.objectContaining({ requestId: 'malformed', stage: 'server.body', outcome: 'failed' }));
    expect(x.provider).not.toHaveBeenCalled(); expect(x.cleanup).not.toHaveBeenCalled();
  } finally { await x.app.close(); }
});

it('correlates both providers with one dictation ID, preserves request IDs, and marks cached responses', async () => {
  const x = setup();
  try {
    expect((await x.submit()).statusCode).toBe(200);
    const cleaned = await x.app.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...x.headers, 'x-sargosh-request-id': 'cleanup-1' }, payload: { text: 'private transcript', language: 'en' } });
    expect(cleaned.statusCode).toBe(200);
    expect((await x.submit()).statusCode).toBe(200); expect(x.provider).toHaveBeenCalledOnce();
    expect(x.events.every(event => event.traceId === 'dictation-123' && Number.isFinite(event.durationMs) && event.durationMs >= 0)).toBe(true);
    expect(x.events.filter(event => event.requestId === 'stt-1').map(event => event.stage)).toContain('server.normalize');
    expect(x.events.filter(event => event.requestId === 'cleanup-1').map(event => event.stage)).toContain('server.cleanup');
    expect(x.events.filter(event => event.stage === 'server.stt.total').map(event => event.cached)).toEqual([false, true]);
    expect(x.events.filter(event => event.stage === 'server.cleanup').map(event => event.model)).toEqual(['gemini-3.5-flash-lite']);
    expect(JSON.stringify(x.events)).not.toMatch(/private|secret-token|authorization/i);
  } finally { await x.app.close(); }
});
it('records quota failures without invoking a provider and ignores unsafe tracing headers', async () => {
  const x = setup();
  vi.mocked(x.store.reserve).mockRejectedValue(new UsageError('DAILY_LIMIT', 'private message', 429));
  try {
    expect((await x.submit('safe-request', '../unsafe-trace')).statusCode).toBe(429);
    expect(x.provider).not.toHaveBeenCalled();
    expect(x.events.every(event => event.traceId === 'safe-request')).toBe(true);
    expect(x.events).toContainEqual(expect.objectContaining({ stage: 'server.reserve', outcome: 'failed' }));
    expect(x.events).toContainEqual(expect.objectContaining({ stage: 'server.stt.total', outcome: 'failed', statusCode: 429 }));
    expect(JSON.stringify(x.events)).not.toContain('private message');
  } finally { await x.app.close(); }
});
it('records provider failure without charging a successful completion or leaking the response', async () => {
  const x = setup();
  x.cleanup.mockResolvedValue(new Response('private provider error', { status: 429 }));
  try {
    const result = await x.app.inject({ method: 'POST', url: '/v1/cleanup', headers: { ...x.headers, 'x-sargosh-request-id': 'cleanup-failure' }, payload: { text: 'private transcript', language: 'en' } });
    expect(result.statusCode).toBe(429);
    expect(x.events).toContainEqual(expect.objectContaining({ stage: 'server.cleanup', outcome: 'failed' }));
    expect(x.events).toContainEqual(expect.objectContaining({ stage: 'server.cleanup.total', outcome: 'failed', statusCode: 429 }));
    expect(x.events.some(event => event.stage === 'provider.cleanup.body')).toBe(false);
    expect(x.store.finish).not.toHaveBeenCalled(); expect(x.store.release).not.toHaveBeenCalled();
    expect(JSON.stringify(x.events)).not.toContain('private');
  } finally { await x.app.close(); }
});
it('measures reservation release on a pre-dispatch failure without invoking the model', async () => {
  const x = setup();
  vi.mocked(x.store.dispatch).mockRejectedValue(new UsageError('REQUEST_PENDING', 'private storage error', 409));
  try {
    expect((await x.submit()).statusCode).toBe(409);
    expect(x.provider).not.toHaveBeenCalled(); expect(x.store.release).toHaveBeenCalledOnce();
    expect(x.events).toContainEqual(expect.objectContaining({ stage: 'server.dispatch', outcome: 'failed' }));
    expect(x.events).toContainEqual(expect.objectContaining({ stage: 'server.release', outcome: 'ok' }));
  } finally { await x.app.close(); }
});
it('does not turn a logging failure into a failed cloud request', async () => {
  const x = setup(() => { throw new Error('diagnostics unavailable'); });
  try { expect((await x.submit()).statusCode).toBe(200); expect(x.store.finish).toHaveBeenCalledOnce(); }
  finally { await x.app.close(); }
});
it('carries the same trace ID in both client HTTP requests without adding it to cleanup content', async () => {
  const calls: { url: string; headers: Headers; body: unknown }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body });
    return new Response(JSON.stringify(String(url).endsWith('/health') ? { status: 'ok', service: 'sargosh-api' } : String(url).includes('/transcriptions') ?
      { text: 'Hello', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 } : { text: 'Hello.', model: 'gemini-3.5-flash-lite' }));
  };
  const signal = new AbortController().signal;
  await transcribeViaLocalAPI({ traceId: 'dictation', requestId: 'speech-request', audio: new Uint8Array([1]).buffer, mimeType: 'audio/webm', language: 'en' }, signal, 'https://api.test', fetcher, 'token');
  await cleanupViaLocalAPI({ traceId: 'dictation', requestId: 'cleanup-request', text: 'Hello', language: 'en' }, signal, 'https://api.test', fetcher, 'token');
  const uploads = calls.filter(call => !call.url.endsWith('/health'));
  expect(uploads.map(call => call.headers.get('x-sargosh-trace-id'))).toEqual(['dictation', 'dictation']);
  expect(uploads.map(call => call.headers.get('x-sargosh-request-id'))).toEqual(['speech-request', 'cleanup-request']);
  expect(JSON.parse(uploads[1].body as string)).toEqual({ text: 'Hello', language: 'en' });
});
