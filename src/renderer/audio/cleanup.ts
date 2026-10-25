import { INITIAL_CLEANUP, MAX_CLEANUP_CHARS, type CleanupResult, type CleanupState } from '../../shared/cleanup';
import type { SpeechLanguage } from '../../shared/transcription';
export type CleanupTransport = (text: string, language: SpeechLanguage, requestId: string, signal: AbortSignal) => Promise<CleanupResult>;
export class CleanupController {
  private state: CleanupState = { ...INITIAL_CLEANUP };
  private active?: AbortController;
  private listeners = new Set<() => void>();
  constructor(private transport: CleanupTransport, private makeId: () => string = () => crypto.randomUUID()) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<CleanupState>) { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  configure(enabled: boolean) { if (!this.active) this.update({ enabled }); }
  async start(sessionId: string, text: string, language: SpeechLanguage) {
    if (this.active) return;
    if (!text.trim()) { this.clear(); return; }
    if (text.length > MAX_CLEANUP_CHARS) { this.update({ phase: 'failed', sessionId, result: null, message: 'This transcript exceeds the cleanup limit. The original transcript is available.' }); return; }
    const abort = new AbortController(); this.active = abort;
    this.update({ phase: 'working', sessionId, result: null, message: 'Cleaning the transcript with Gemini...' });
    try {
      const result = await this.transport(text, language, this.makeId(), abort.signal);
      if (this.active !== abort || abort.signal.aborted) return;
      this.active = undefined;
      this.update({ phase: 'completed', result, message: result.text ? 'Cleanup ready. Review the result against the original transcript.' : 'Cleanup removed all text. The original transcript is still available.' });
    } catch (error) {
      if (this.active !== abort) return;
      this.active = undefined;
      this.update({ phase: abort.signal.aborted ? 'cancelled' : 'failed', message: error instanceof Error ? error.message : 'Cleanup failed. The original transcript is available.' });
    }
  }
  cancel() {
    if (!this.active) return;
    const active = this.active; this.active = undefined; active.abort();
    this.update({ phase: 'cancelled', result: null, message: 'Cleanup cancelled. The original transcript is available.' });
  }
  clear() { const active = this.active; this.active = undefined; active?.abort(); this.update({ ...INITIAL_CLEANUP, enabled: this.state.enabled }); }
}
