import { INITIAL_TRANSCRIPTION, type SpeechLanguage, type Transcript, type TranscriptionState } from '../../shared/transcription';
export type TranscriptionTransport = (blob: Blob, language: SpeechLanguage, requestId: string, signal: AbortSignal) => Promise<Transcript>;
export class TranscriptionController {
  private state: TranscriptionState = { ...INITIAL_TRANSCRIPTION };
  private active?: AbortController;
  private listeners = new Set<() => void>();
  constructor(private transport: TranscriptionTransport, private makeId: () => string = () => crypto.randomUUID()) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<TranscriptionState>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(); }
  configure(value: { language?: SpeechLanguage; automatic?: boolean }) { if (!this.active) this.update(value); }
  async start(sessionId: string, blob: Blob) {
    if (this.active) return;
    const abort = new AbortController(); this.active = abort;
    this.update({ phase: 'working', sessionId, result: null, message: 'Transcribing with Deepgram...' });
    try {
      const result = await this.transport(blob, this.state.language, this.makeId(), abort.signal);
      if (this.active !== abort || abort.signal.aborted) return;
      this.active = undefined;
      this.update({ phase: 'completed', result, message: result.text ? 'Transcript ready. Automatic insertion is not connected yet.' : 'No speech was recognized. Play the clip and check the microphone or language.' });
    } catch (error) {
      if (this.active !== abort) return;
      this.active = undefined;
      this.update({ phase: abort.signal.aborted ? 'cancelled' : 'failed', message: abort.signal.aborted ? 'Transcription cancelled.' : error instanceof Error ? error.message : 'Transcription failed. The clip is still available.' });
    }
  }
  cancel() {
    if (!this.active) return;
    const active = this.active; this.active = undefined; active.abort();
    this.update({ phase: 'cancelled', result: null, message: 'Transcription cancelled. The clip is still available.' });
  }
  clear() {
    const active = this.active; this.active = undefined; active?.abort();
    this.update({ ...INITIAL_TRANSCRIPTION, language: this.state.language, automatic: this.state.automatic });
  }
}
