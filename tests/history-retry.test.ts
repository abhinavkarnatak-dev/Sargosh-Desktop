import { expect, it, vi } from 'vitest';
import { retrySavedTranscript } from '../src/main/history-retry';
const id = '11111111-1111-4111-8111-111111111111';
function fixture(cleanupEnabled = true) {
  const history = { get: vi.fn(async () => ({ id, createdAt: '', text: 'Previous', words: 1, durationMs: 1000, status: 'completed' as const, language: 'hi' as const, cleanupEnabled })), audio: vi.fn(async () => ({ audio: new ArrayBuffer(4), mimeType: 'audio/webm' })), update: vi.fn(async () => {}) };
  const provider = { transcribe: vi.fn(async () => ({ ok: true as const, result: { text: 'Raw words', language: 'hi' as const, model: 'nova-3' as const, durationMs: 1000, confidence: .9 } })), cleanup: vi.fn(async () => ({ ok: true as const, result: { text: 'Final words', model: 'gemini-3.5-flash-lite' as const } })) };
  return { history, provider };
}
it('reuses saved audio and language, updates the same entry, and performs no text delivery', async () => {
  const { history, provider } = fixture(); await retrySavedTranscript(id, history, provider);
  expect(provider.transcribe).toHaveBeenCalledWith(expect.objectContaining({ language: 'hi', audio: expect.any(ArrayBuffer) }));
  expect(history.update).toHaveBeenCalledWith(expect.objectContaining({ id, text: 'Final words', originalText: 'Raw words', status: 'completed' }));
});
it('skips cleanup when it was disabled for the saved recording', async () => {
  const { history, provider } = fixture(false); await retrySavedTranscript(id, history, provider);
  expect(provider.cleanup).not.toHaveBeenCalled(); expect(history.update).toHaveBeenCalledWith(expect.objectContaining({ text: 'Raw words' }));
});
it('keeps an existing good transcript if a paid stage fails', async () => {
  const { history, provider } = fixture(); provider.cleanup.mockRejectedValueOnce(new Error('Quota'));
  await expect(retrySavedTranscript(id, history, provider)).rejects.toThrow('Quota'); expect(history.update).not.toHaveBeenCalled();
});
