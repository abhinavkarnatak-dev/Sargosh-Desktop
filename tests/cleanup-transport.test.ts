import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTransport } from '../src/renderer/audio/cleanup-transport';
import { DEFAULT_CLEANUP_MODEL } from '../src/shared/cleanup';
afterEach(() => vi.unstubAllGlobals());
describe('desktop cleanup transport', () => {
  it('sends only transcript text, language, and a request ID through the narrow bridge', async () => {
    const result = { text: 'Meet Thursday.', model: DEFAULT_CLEANUP_MODEL };
    const cleanupTranscript = vi.fn(async (_request: unknown) => ({ ok: true, result }));
    vi.stubGlobal('window', { sargosh: { cleanupTranscript, cancelTranscription: vi.fn() } });
    expect(await cleanupTransport('Tuesday sorry Thursday', 'en', 'request', new AbortController().signal)).toEqual(result);
    expect(cleanupTranscript).toHaveBeenCalledWith({ requestId: 'request', text: 'Tuesday sorry Thursday', language: 'en' });
  });
  it('does not start IPC after cancellation has already occurred', async () => {
    const cleanupTranscript = vi.fn();
    vi.stubGlobal('window', { sargosh: { cleanupTranscript } });
    const abort = new AbortController(); abort.abort();
    await expect(cleanupTransport('text', 'en', 'request', abort.signal)).rejects.toThrow('cancelled');
    expect(cleanupTranscript).not.toHaveBeenCalled();
  });
  it('cancels an in-flight cleanup by its request ID', async () => {
    let resolve!: (value: unknown) => void;
    const cleanupTranscript = vi.fn(() => new Promise(yes => { resolve = yes; }));
    const cancelTranscription = vi.fn(async () => {});
    vi.stubGlobal('window', { sargosh: { cleanupTranscript, cancelTranscription } });
    const abort = new AbortController();
    const pending = cleanupTransport('text', 'en', 'request', abort.signal);
    abort.abort(); expect(cancelTranscription).toHaveBeenCalledWith('request');
    resolve({ ok: false, code: 'CANCELLED', message: 'Cleanup cancelled.' });
    await expect(pending).rejects.toThrow('cancelled');
  });
});
