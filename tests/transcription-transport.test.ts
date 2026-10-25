import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcriptionTransport } from '../src/renderer/audio/transcription-transport';
import type { Transcript } from '../src/shared/transcription';
const result: Transcript = { text: 'Desktop transcript.', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 };
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
afterEach(() => vi.unstubAllGlobals());
describe('desktop audio transport', () => {
  it('forwards audio bytes and metadata through the narrow bridge', async () => {
    const transcribeAudio = vi.fn(async (_request: { audio: ArrayBuffer; requestId: string; language: string }) => ({ ok: true, result }));
    const cancelTranscription = vi.fn(async () => {});
    vi.stubGlobal('window', { sargosh: { transcribeAudio, cancelTranscription } });
    const transcript = await transcriptionTransport(new Blob(['audio bytes'], { type: 'audio/webm' }), 'en', 'one', new AbortController().signal);
    expect(transcript).toEqual(result);
    const request = transcribeAudio.mock.calls[0]?.[0] as unknown as { audio: ArrayBuffer; requestId: string; language: string };
    expect(Buffer.from(request.audio).toString()).toBe('audio bytes');
    expect(request).toMatchObject({ requestId: 'one', language: 'en' });
    expect(cancelTranscription).not.toHaveBeenCalled();
  });
  it('forwards cancellation of an in-flight IPC request', async () => {
    let resolve!: (value: unknown) => void;
    const transcribeAudio = vi.fn(() => new Promise(yes => { resolve = yes; }));
    const cancelTranscription = vi.fn(async () => {});
    vi.stubGlobal('window', { sargosh: { transcribeAudio, cancelTranscription } });
    const abort = new AbortController();
    const pending = transcriptionTransport(new Blob(['audio'], { type: 'audio/webm' }), 'en', 'one', abort.signal);
    await flush(); abort.abort();
    expect(cancelTranscription).toHaveBeenCalledWith('one');
    resolve({ ok: false, code: 'CANCELLED', message: 'Transcription cancelled.' });
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('does not upload audio when cancellation wins before reading the Blob', async () => {
    let resolve!: (value: ArrayBuffer) => void;
    class SlowBlob extends Blob { arrayBuffer() { return new Promise<ArrayBuffer>(yes => { resolve = yes; }); } }
    const transcribeAudio = vi.fn();
    vi.stubGlobal('window', { sargosh: { transcribeAudio } });
    const abort = new AbortController();
    const pending = transcriptionTransport(new SlowBlob(['audio'], { type: 'audio/webm' }), 'en', 'one', abort.signal);
    abort.abort(); resolve(new Uint8Array([1]).buffer);
    await expect(pending).rejects.toThrow('cancelled'); expect(transcribeAudio).not.toHaveBeenCalled();
  });
});
