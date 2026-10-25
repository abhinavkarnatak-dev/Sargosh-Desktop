import { describe, expect, it, vi } from 'vitest';
import { TranscriptionController, type TranscriptionTransport } from '../src/renderer/audio/transcription';
import type { Transcript } from '../src/shared/transcription';
const result: Transcript = { text: 'Hello there.', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 };
function deferred() { let resolve!: (value: Transcript) => void; let reject!: (error: Error) => void; const promise = new Promise<Transcript>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
describe('transcription result lifecycle', () => {
  it('publishes real transport output and prevents duplicate clicks', async () => {
    const response = deferred(); const transport = vi.fn<TranscriptionTransport>(() => response.promise);
    const controller = new TranscriptionController(transport, () => 'request');
    const first = controller.start('recording', new Blob(['audio'])); await controller.start('recording', new Blob(['audio']));
    expect(controller.getState().phase).toBe('working'); expect(transport).toHaveBeenCalledOnce();
    response.resolve(result); await first;
    expect(controller.getState()).toMatchObject({ phase: 'completed', result });
  });
  it('aborts cancellation and ignores late paid responses', async () => {
    const response = deferred(); const transport = vi.fn<TranscriptionTransport>(() => response.promise);
    const controller = new TranscriptionController(transport, () => 'request');
    const pending = controller.start('recording', new Blob(['audio'])); controller.cancel();
    expect(transport.mock.calls[0][3].aborted).toBe(true);
    response.resolve(result); await pending;
    expect(controller.getState()).toMatchObject({ phase: 'cancelled', result: null });
  });
  it('does not let a stale response replace a newer session', async () => {
    const first = deferred(); const second = deferred();
    const transport = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const controller = new TranscriptionController(transport, () => 'request');
    const old = controller.start('old', new Blob(['audio'])); controller.clear();
    const next = controller.start('new', new Blob(['audio']));
    first.resolve(result); await old; expect(controller.getState().phase).toBe('working');
    second.resolve({ ...result, text: 'New result' }); await next;
    expect(controller.getState()).toMatchObject({ sessionId: 'new', result: { text: 'New result' } });
  });
  it('allows only explicit retries after failure', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('Provider credits unavailable')).mockResolvedValueOnce(result);
    const controller = new TranscriptionController(transport, () => 'request');
    await controller.start('recording', new Blob(['audio']));
    expect(controller.getState()).toMatchObject({ phase: 'failed', message: 'Provider credits unavailable' });
    expect(transport).toHaveBeenCalledOnce();
    await controller.start('recording', new Blob(['audio'])); expect(controller.getState().phase).toBe('completed');
  });
  it('preserves language and auto settings across recordings but locks them during a request', async () => {
    const response = deferred();
    const controller = new TranscriptionController(() => response.promise, () => 'request');
    controller.configure({ language: 'hi', automatic: true }); controller.clear();
    const pending = controller.start('recording', new Blob(['audio']));
    controller.configure({ language: 'en', automatic: false });
    expect(controller.getState()).toMatchObject({ language: 'hi', automatic: true });
    response.resolve({ ...result, language: 'hi' }); await pending;
  });
  it('handles no-speech results without inventing text', async () => {
    const controller = new TranscriptionController(async () => ({ ...result, text: '' }), () => 'request');
    await controller.start('recording', new Blob(['audio']));
    expect(controller.getState()).toMatchObject({ phase: 'completed', result: { text: '' } });
    expect(controller.getState().message).toContain('No speech');
  });
});
