import { afterEach, expect, it, vi } from 'vitest';
import { HistoryPersistence } from '../src/renderer/audio/history';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => { vi.unstubAllGlobals(); });
it('saves audio before its final text and deduplicates repeated notifications', async () => {
  const saveHistory = vi.fn(async () => {}); const updateHistory = vi.fn(async () => {});
  vi.stubGlobal('window', { sargosh: { saveHistory, updateHistory } });
  const archive = new HistoryPersistence(); const clip = new Blob(['voice'], { type: 'audio/webm' });
  const saved = archive.capture(id, clip, 'en', true);
  const result = { id, text: 'Final', originalText: 'Raw', language: 'en' as const, cleanupEnabled: true, status: 'completed' as const };
  await archive.remember(result); await saved; await archive.remember(result);
  expect(saveHistory).toHaveBeenCalledOnce(); expect(updateHistory).toHaveBeenCalledExactlyOnceWith(result);
  expect(saveHistory.mock.invocationCallOrder[0]).toBeLessThan(updateHistory.mock.invocationCallOrder[0]);
});
it('keeps a visible failure and does not claim a transcript was saved when audio saving failed', async () => {
  const updateHistory = vi.fn(); vi.stubGlobal('window', { sargosh: { saveHistory: vi.fn().mockRejectedValue(new Error('Full disk')), updateHistory } });
  const archive = new HistoryPersistence(); await archive.capture(id, new Blob(['clip'], { type: 'audio/webm' }), 'en', true);
  await archive.remember({ id, text: 'Text', originalText: 'Raw', language: 'en', cleanupEnabled: true, status: 'completed' });
  expect(archive.getState().error).toContain('Could not save'); expect(updateHistory).not.toHaveBeenCalled();
});
it('serializes explicit retry actions and restores the idle state after failure', async () => {
  let resolve!: () => void; const retryHistory = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  vi.stubGlobal('window', { sargosh: { retryHistory } }); const archive = new HistoryPersistence();
  const pending = archive.retry(id); await archive.retry(id); expect(retryHistory).toHaveBeenCalledOnce(); expect(archive.getState().retryingId).toBe(id);
  resolve(); await pending; expect(archive.getState().retryingId).toBeNull();
});
