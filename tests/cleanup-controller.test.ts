import { describe, expect, it, vi } from 'vitest';
import { CleanupController, type CleanupTransport } from '../src/renderer/audio/cleanup';
import { DEFAULT_CLEANUP_MODEL, MAX_CLEANUP_CHARS, type CleanupResult } from '../src/shared/cleanup';
const result: CleanupResult = { text: 'Meet Thursday.', model: DEFAULT_CLEANUP_MODEL };
function deferred() { let resolve!: (value: CleanupResult) => void; const promise = new Promise<CleanupResult>(yes => { resolve = yes; }); return { promise, resolve }; }
describe('cleanup lifecycle', () => {
  it('publishes one cleanup result and rejects duplicate starts', async () => {
    const reply = deferred(); const transport = vi.fn<CleanupTransport>(() => reply.promise);
    const controller = new CleanupController(transport, () => 'request');
    const first = controller.start('recording', 'Tuesday sorry Thursday', 'en');
    await controller.start('recording', 'same', 'en');
    expect(transport).toHaveBeenCalledOnce(); reply.resolve(result); await first;
    expect(controller.getState()).toMatchObject({ phase: 'completed', result, sessionId: 'recording' });
  });
  it('ignores a late response after cancellation', async () => {
    const reply = deferred(); const transport = vi.fn<CleanupTransport>(() => reply.promise);
    const controller = new CleanupController(transport, () => 'request');
    const pending = controller.start('recording', 'raw transcript', 'en'); controller.cancel();
    expect(transport.mock.calls[0][3].aborted).toBe(true); reply.resolve(result); await pending;
    expect(controller.getState()).toMatchObject({ phase: 'cancelled', result: null });
  });
  it('does not put an old result into the next recording', async () => {
    const old = deferred(); const next = deferred();
    const transport = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const controller = new CleanupController(transport, () => 'request');
    const first = controller.start('old', 'old transcript', 'en'); controller.clear();
    const second = controller.start('new', 'new transcript', 'en'); old.resolve(result); await first;
    expect(controller.getState()).toMatchObject({ phase: 'working', sessionId: 'new', result: null });
    next.resolve({ ...result, text: 'New result' }); await second;
    expect(controller.getState().result?.text).toBe('New result');
  });
  it('leaves failure visible and retries only on an explicit call', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('Gemini quota reached')).mockResolvedValueOnce(result);
    const controller = new CleanupController(transport, () => 'request');
    await controller.start('recording', 'original', 'en');
    expect(controller.getState()).toMatchObject({ phase: 'failed', result: null, message: 'Gemini quota reached' });
    expect(transport).toHaveBeenCalledOnce();
    await controller.start('recording', 'original', 'en'); expect(controller.getState().phase).toBe('completed');
  });
  it('skips blank transcripts and reports excessive input without calling Gemini', async () => {
    const transport = vi.fn<CleanupTransport>(); const controller = new CleanupController(transport);
    await controller.start('recording', '', 'en'); expect(controller.getState().phase).toBe('idle');
    await controller.start('recording', 'x'.repeat(MAX_CLEANUP_CHARS + 1), 'en');
    expect(controller.getState().phase).toBe('failed'); expect(transport).not.toHaveBeenCalled();
  });
  it('preserves the cleanup preference across recordings and locks it while working', async () => {
    const reply = deferred(); const controller = new CleanupController(() => reply.promise, () => 'request');
    controller.configure(false); controller.clear(); expect(controller.getState().enabled).toBe(false);
    controller.configure(true); const pending = controller.start('recording', 'text', 'en');
    controller.configure(false); expect(controller.getState().enabled).toBe(true);
    reply.resolve(result); await pending;
  });
});
