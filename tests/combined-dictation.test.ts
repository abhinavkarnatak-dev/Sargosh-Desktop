import { expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
import { transcribeViaLocalAPI } from '../src/shared/local-api';
import { UsageError, type UsageStore } from '../src/server/usage';
import type { TimingEvent } from '../src/shared/timing';

function fixture(hosted = true, transcript = 'Um hello team.') {
  const store = {
    snapshot: vi.fn(async () => ({ enabled: true })),
    reserve: vi.fn<UsageStore['reserve']>(async (userId, requestId, kind) => ({ userId, requestId, kind, leaseId: 'lease-' + kind })),
    reservePractice: vi.fn<NonNullable<UsageStore['reservePractice']>>(async (userId, requestId, kind) => ({ userId, requestId, kind, leaseId: 'practice-' + kind })),
    dispatch: vi.fn<UsageStore['dispatch']>(async () => {}), finish: vi.fn(async () => {}), release: vi.fn(async () => {})
  };
  const verify = vi.fn(async (token: string) => token === 'valid' ? 'owner' : null);
  const stt = vi.fn<typeof fetch>(async () => Response.json({ results: { channels: [{ alternatives: [{ transcript, confidence: .9 }] }] }, metadata: { duration: 2 } }));
  const llm = vi.fn<typeof fetch>(async () => Response.json({ usageMetadata: { promptTokenCount: 100, totalTokenCount: 140 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ text: 'Hello team.' }) }] } }] }));
  const events: TimingEvent[] = [];
  const app = createServer({ hostedMode: hosted, localMode: !hosted, allowedHosts: ['api.test'], verifySession: verify,
    usageStore: store as unknown as UsageStore, apiKey: 'fixture', geminiApiKey: 'fixture', fetcher: stt, geminiFetcher: llm,
    normalize: async () => ({ audio: Buffer.from('wav'), durationSeconds: 2 }), timingSink: event => events.push(event) });
  const headers = { host: hosted ? 'api.test' : '127.0.0.1:4318', authorization: 'Bearer valid', 'content-type': 'audio/webm', 'x-sargosh-request-id': 'one' };
  const send = (practice = false, patch = {}) => app.inject({ method: 'POST', url: '/v1/' + (practice ? 'practice/' : '') + 'dictations?language=en', headers: { ...headers, ...patch }, payload: Buffer.from('audio') });
  return { app, store, verify, stt, llm, events, headers, send };
}
it('runs STT and cleanup with one auth/eligibility check, separate costs and one audio allowance', async () => {
  const x = fixture();
  try {
    const reply = await x.send(); expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ text: 'Um hello team.', cleanup: { ok: true, result: { text: 'Hello team.' } } });
    expect(x.verify).toHaveBeenCalledOnce(); expect(x.store.snapshot).toHaveBeenCalledOnce();
    expect(x.store.reserve.mock.calls.map(call => [call[2], call[4]])).toEqual([['stt', 2], ['cleanup', 0]]);
    expect(x.store.finish).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cleanup' }), 130);
    expect(x.events.filter(event => event.stage === 'server.auth')).toHaveLength(1);
    expect(x.events.some(event => event.stage === 'server.dictation.total')).toBe(true);
    expect(x.events.some(event => event.stage === 'server.stt')).toBe(true);
    expect(x.events.some(event => event.stage === 'server.cleanup')).toBe(true);
    expect(x.stt.mock.invocationCallOrder[0]).toBeLessThan(x.llm.mock.invocationCallOrder[0]);
  } finally { await x.app.close(); }
});
it('deduplicates both paid stages and caches the full combined response', async () => {
  const x = fixture(); try {
    const first = await x.send(); const second = await x.send(); expect(second.json()).toEqual(first.json());
    expect(x.stt).toHaveBeenCalledOnce(); expect(x.llm).toHaveBeenCalledOnce(); expect(x.store.reserve).toHaveBeenCalledTimes(2);
    expect((await x.app.inject({ method: 'POST', url: '/v1/dictations?language=en', headers: x.headers, payload: Buffer.from('different') })).statusCode).toBe(409);
  } finally { await x.app.close(); }
});
it('keeps the transcript on cleanup failure, does not re-charge a transport retry, and does not release dispatched costs', async () => {
  const x = fixture(); x.llm.mockResolvedValue(Response.json({}, { status: 429 }));
  try {
    const reply = await x.send(); expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ text: 'Um hello team.', cleanup: { ok: false, code: 'GEMINI_QUOTA' } });
    expect((await x.send()).json()).toEqual(reply.json()); expect(x.llm).toHaveBeenCalledOnce(); expect(x.store.release).not.toHaveBeenCalled();
  } finally { await x.app.close(); }
});
it('never starts paid work for an invalid account or exhausted audio allowance', async () => {
  const x = fixture(); try {
    expect((await x.send(false, { authorization: 'Bearer invalid' })).statusCode).toBe(401);
    x.store.reserve.mockRejectedValueOnce(new UsageError('DAILY_LIMIT', 'Daily allowance reached.'));
    expect((await x.send()).statusCode).toBe(429); expect(x.stt).not.toHaveBeenCalled(); expect(x.llm).not.toHaveBeenCalled();
  } finally { await x.app.close(); }
});
it('preserves the transcript when cleanup allowance fails and never sends it to the model', async () => {
  const x = fixture(); x.store.reserve.mockImplementation(async (userId, requestId, kind) => {
    if (kind === 'cleanup') throw new UsageError('SERVICE_BUDGET', 'Service allowance reached.');
    return { userId, requestId, kind, leaseId: 'stt' };
  });
  try {
    expect((await x.send()).json()).toMatchObject({ text: 'Um hello team.', cleanup: { ok: false, code: 'SERVICE_BUDGET' } });
    expect(x.stt).toHaveBeenCalledOnce(); expect(x.llm).not.toHaveBeenCalled();
  } finally { await x.app.close(); }
});
it('uses the same practice ID for both isolated stages and finishes STT before reserving cleanup', async () => {
  const x = fixture(); try {
    expect((await x.send(true)).json().cleanup.ok).toBe(true); expect(x.store.reserve).not.toHaveBeenCalled();
    expect(x.store.reservePractice.mock.calls.map(call => [call[1], call[2], call[4]])).toEqual([['one', 'stt', 2], ['one', 'cleanup', 0]]);
    expect(x.store.finish.mock.invocationCallOrder[0]).toBeLessThan(x.store.reservePractice.mock.invocationCallOrder[1]);
  } finally { await x.app.close(); }
});
it('skips cleanup for silence', async () => {
  const x = fixture(true, ''); try { expect((await x.send()).json().text).toBe(''); expect(x.llm).not.toHaveBeenCalled(); expect(x.store.reserve).toHaveBeenCalledOnce(); }
  finally { await x.app.close(); }
});
it('uploads once from the local client and preserves both results', async () => {
  const x = fixture(false); const paths: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    paths.push(String(url));
    const response = await x.app.inject({ method: init?.method === 'POST' ? 'POST' : 'GET', url: String(url).replace('/api', ''),
      headers: { ...Object.fromEntries(new Headers(init?.headers)), host: '127.0.0.1:4318' }, payload: init?.body ? Buffer.from(init.body as ArrayBuffer) : undefined });
    return new Response(response.body, { status: response.statusCode });
  };
  try {
    const reply = await transcribeViaLocalAPI({ cleanup: true, requestId: 'one', language: 'en', mimeType: 'audio/webm', audio: new Uint8Array([1]).buffer }, new AbortController().signal, '/api', fetcher, 'valid');
    expect(reply.cleanup).toMatchObject({ ok: true, result: { text: 'Hello team.' } });
    expect(paths).toEqual(['/api/v1/local-session', '/api/v1/dictations?language=en']); expect(x.verify).toHaveBeenCalledOnce();
  } finally { await x.app.close(); }
});
it('rejects missing or malformed combined cleanup results instead of making another paid call', async () => {
  const result = { text: 'Hello', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 };
  const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/v1/local-session') ? Response.json({ token: 'a'.repeat(64) }) : Response.json(result));
  await expect(transcribeViaLocalAPI({ cleanup: true, requestId: 'one', language: 'en', mimeType: 'audio/webm', audio: new Uint8Array([1]).buffer }, new AbortController().signal, '/api', fetcher)).rejects.toMatchObject({ code: 'LOCAL_API' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('releases only the undispatched cleanup reservation when its dispatch fails', async () => {
  const x = fixture(); x.store.dispatch.mockImplementation(async lease => { if (lease.kind === 'cleanup') throw new UsageError('REQUEST_PENDING', 'Expired.'); });
  try {
    expect((await x.send()).json()).toMatchObject({ text: 'Um hello team.', cleanup: { ok: false, code: 'REQUEST_PENDING' } });
    expect(x.llm).not.toHaveBeenCalled(); expect(x.store.release).toHaveBeenCalledOnce();
    expect(x.store.release).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cleanup' }));
  } finally { await x.app.close(); }
});
it('propagates disconnection to the cleanup provider without dispatching a second request', async () => {
  const x = fixture(); let disconnect!: () => void;
  x.app.addHook('preHandler', async request => { disconnect = () => { request.raw.emit('aborted'); }; });
  x.llm.mockImplementationOnce(async (_url, init) => {
    const signal = init!.signal!;
    disconnect(); expect(signal.aborted).toBe(true);
    throw new DOMException('Aborted', 'AbortError');
  });
  try {
    const reply = await x.send(); expect(reply.json().cleanup).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(x.stt).toHaveBeenCalledOnce(); expect(x.llm).toHaveBeenCalledOnce(); expect(x.store.release).not.toHaveBeenCalled();
  } finally { await x.app.close(); }
});

it('reserves retry headroom up front and keeps uncertain failed-attempt spend after recovery', async () => {
  const { cleanupAttemptCost, cleanupReservationCost } = await import('../src/server/cleanup-budget');
  const x = fixture(); x.llm.mockResolvedValueOnce(new Response('', { status: 503 }));
  try {
    expect((await x.send()).json().cleanup.ok).toBe(true);
    expect(x.llm).toHaveBeenCalledTimes(2);
    expect(x.store.reserve).toHaveBeenCalledWith('owner', 'one', 'cleanup', expect.any(String), 0, cleanupReservationCost('Um hello team.', 'en'));
    expect(x.store.finish).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cleanup' }), 130 + cleanupAttemptCost('Um hello team.', 'en'));
    expect(x.store.reserve.mock.calls.filter(call => call[2] === 'stt')).toHaveLength(1);
  } finally { await x.app.close(); }
});

it.each([false,true])('unblocks a new dictation immediately after failed cleanup with practice=%s, retaining spending',async practice=>{
 const x=fixture();let active=false;
 const reserve=async(userId:string,requestId:string,kind:'stt'|'cleanup')=>{if(active)throw new UsageError('BUSY','Another request is still processing for your account.');active=true;return {userId,requestId,kind,leaseId:'lease-'+kind};};
 x.store.reserve.mockImplementation(reserve);x.store.reservePractice.mockImplementation(reserve);
 x.store.finish.mockImplementation(async()=>{active=false;});
 x.llm.mockResolvedValueOnce(Response.json({}, {status:429}));
 try{
  expect((await x.send(practice)).json().cleanup).toMatchObject({ok:false,code:'GEMINI_QUOTA'});expect(active).toBe(false);
  expect(x.store.finish).toHaveBeenLastCalledWith(expect.objectContaining({kind:'cleanup'}),undefined);expect(x.store.release).not.toHaveBeenCalled();
  const retry=await x.send(practice,{'x-sargosh-request-id':'next'});expect(retry.statusCode).toBe(200);expect(retry.json().cleanup.ok).toBe(true);expect(active).toBe(false);
 }finally{await x.app.close();}
});
