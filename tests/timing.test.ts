import { afterEach, expect, it, vi } from 'vitest';
import { emitTiming, safeTiming, setTimingSink, TimingTrace, type TimingEvent } from '../src/shared/timing';

afterEach(() => { setTimingSink(event => console.info(JSON.stringify(event))); vi.unstubAllGlobals(); });
it('keeps bounded socket diagnostics and strips arbitrary connection details', () => {
  const input = { event: 'sargosh.timing', schemaVersion: 1, traceId: 'session', scope: 'client', stage: 'stream.handshake', durationMs: 3, outcome: 'failed', statusCode: 429, networkError: 'ECONNRESET', handshakeFailure: 'http-rejected', closeCode: 1006 };
  expect(safeTiming(input)).toMatchObject({ statusCode: 429, networkError: 'ECONNRESET', handshakeFailure: 'http-rejected', closeCode: 1006 });
  const safe = safeTiming({ ...input, networkError: 'Bearer private', handshakeFailure: 'private transcript' });
  expect(safe).not.toHaveProperty('networkError'); expect(safe).not.toHaveProperty('handshakeFailure');
});
it('logs the delivery method and bounded fallback codes without arbitrary error details', () => {
  const event = { event: 'sargosh.timing', schemaVersion: 1, traceId: 'session', scope: 'desktop', stage: 'delivery.path', durationMs: 0, outcome: 'ok',
    method: 'keyboard', fallbackReason: 'clipboard-format', clipboardFormat: 14, windowsError: 5 };
  expect(safeTiming(event)).toMatchObject({ method: 'keyboard', fallbackReason: 'clipboard-format', clipboardFormat: 14, windowsError: 5 });
  const safe = safeTiming({ ...event, method: 'private transcript', fallbackReason: 'private clipboard contents' });
  expect(safe).not.toHaveProperty('method'); expect(safe).not.toHaveProperty('fallbackReason');
});
it('uses elapsed local time, records failed work without its exception contents, and never logs the result', async () => {
  let time = 10; const events: TimingEvent[] = [];
  const trace = new TimingTrace('recording-1', 'desktop', 'request-1', event => events.push(event), () => time);
  const success = trace.measure('stt.transport', async () => { time = 35; return { text: 'private transcript' }; });
  expect(await success).toEqual({ text: 'private transcript' });
  await expect(trace.measure('cleanup.transport', async () => { time = 45; throw new Error('secret provider detail'); })).rejects.toThrow('secret provider detail');
  expect(events.map(event => [event.durationMs, event.outcome])).toEqual([[25, 'ok'], [10, 'failed']]);
  expect(JSON.stringify(events)).not.toMatch(/private|secret provider/);
});
it('emits cancellation immediately and ignores later completion', async () => {
  let time = 0; let resolve!: () => void; const output = vi.fn(); const abort = new AbortController();
  const trace = new TimingTrace('recording-1', 'desktop', undefined, output, () => time);
  const pending = trace.measure('cleanup.transport', () => new Promise<void>(yes => { resolve = yes; }), {}, abort.signal);
  time = 12; abort.abort(); time = 99; resolve(); await pending;
  expect(output).toHaveBeenCalledOnce(); expect(output.mock.calls[0][0]).toMatchObject({ durationMs: 12, outcome: 'cancelled' });
});
it('strips unapproved metadata and rejects malformed identifiers and durations', () => {
  const event = { event: 'sargosh.timing', schemaVersion: 1, traceId: 'session', scope: 'desktop', stage: 'delivery.total', durationMs: 10, outcome: 'ok', characters: 20,
    text: 'private', audio: 'private', authorization: 'Bearer secret', email: 'private@example.com' };
  expect(safeTiming(event)).toEqual({ event: 'sargosh.timing', schemaVersion: 1, traceId: 'session', scope: 'desktop', stage: 'delivery.total', durationMs: 10, outcome: 'ok', characters: 20 });
  for (const patch of [{ traceId: 'bad\nsecret' }, { traceId: 'x'.repeat(101) }, { durationMs: NaN }, { durationMs: -1 }, { stage: 'private transcript' }]) expect(safeTiming({ ...event, ...patch })).toBeNull();
});
it('does not fail application work when the diagnostics sink fails', async () => {
  const trace = new TimingTrace('session', 'server', undefined, () => { throw new Error('disk unavailable'); });
  await expect(trace.measure('server.stt', async () => 123)).resolves.toBe(123);
});
it('keeps stop-to-first-input and stop-to-complete isolated across cancellations and later recordings', async () => {
  const output = vi.fn(); setTimingSink(output);
  const { markDictationStop, markFirstInput, finishDictationTiming, startDictationTiming } = await import('../src/renderer/audio/timing');
  startDictationTiming('old'); markDictationStop('old'); finishDictationTiming('old', 'cancelled');
  startDictationTiming('new'); markDictationStop('new'); markFirstInput('old'); markFirstInput('new'); finishDictationTiming('new', 'ok');
  finishDictationTiming('new', 'failed');
  expect(output.mock.calls.map(call => [call[0].traceId, call[0].stage, call[0].outcome])).toEqual([
    ['old', 'dictation.stop_to_complete', 'cancelled'], ['old', 'dictation.stop_to_first_input_ack', 'cancelled'],
    ['new', 'dictation.stop_to_first_input_ack', 'ok'], ['new', 'dictation.stop_to_complete', 'ok'],
  ]);
});

it('keeps known failure codes and strips arbitrary error contents', async () => {
  const output = vi.fn(); const trace = new TimingTrace('session', 'desktop', undefined, output);
  await expect(trace.measure('cleanup.transport', async () => { throw Object.assign(new Error('private'), { code: 'GEMINI_TIMEOUT' }); })).rejects.toThrow('private');
  expect(output.mock.calls[0][0].errorCode).toBe('GEMINI_TIMEOUT');
  expect(JSON.stringify(output.mock.calls)).not.toContain('private');
  const safe = safeTiming({ ...output.mock.calls[0][0], errorCode: 'private transcript' });
  expect(safe).not.toHaveProperty('errorCode');
});
