import { useSyncExternalStore } from 'react';
import type { HistoryResult } from '../../shared/history';
import type { SpeechLanguage } from '../../shared/transcription';
import { TimingTrace } from '../../shared/timing';
export class HistoryPersistence {
  private captures = new Map<string, Promise<boolean>>();
  private results = new Map<string, string>();
  private state = { error: '', retryingId: null as string | null };
  private listeners = new Set<() => void>();
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<typeof this.state>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(); }
  capture(id: string, blob: Blob, language: SpeechLanguage, cleanupEnabled: boolean): Promise<boolean> {
    const pending = this.captures.get(id); if (pending) return pending;
    if (!window.sargosh) return Promise.resolve(false);
    const timing = new TimingTrace(id, 'desktop').span('history.save', { bytes: blob.size });
    const save = (async () => {
      try {
        if (!window.sargosh?.saveHistory) throw new Error();
        const audio = await blob.arrayBuffer();
        await window.sargosh.saveHistory({ id, audio, mimeType: blob.type, language, cleanupEnabled });
        timing.end(); this.update({ error: '' }); return true;
      } catch { timing.end('failed'); this.update({ error: 'Could not save this recording locally. Your current preview is still available. Check free disk space and restart Sargosh if needed.' }); return false; }
    })();
    this.captures.set(id, save); return save;
  }
  async remember(result: HistoryResult) {
    const signature = JSON.stringify(result); if (this.results.get(result.id) === signature) return;
    this.results.set(result.id, signature);
    if (!await this.captures.get(result.id)) return;
    try { await window.sargosh!.updateHistory(result); }
    catch { this.results.delete(result.id); this.update({ error: 'Your audio was saved, but its transcript could not be saved. You can retry it from history.' }); }
  }
  async retry(id: string) {
    if (this.state.retryingId) return;
    this.update({ retryingId: id, error: '' });
    try { await window.sargosh!.retryHistory(id); }
    catch { this.update({ error: 'Could not retry this transcript. Your saved text and audio are still available.' }); }
    finally { this.update({ retryingId: null }); }
  }
}
export const savedHistory = new HistoryPersistence();
export const useSavedHistory = () => useSyncExternalStore(savedHistory.subscribe, savedHistory.getState);
