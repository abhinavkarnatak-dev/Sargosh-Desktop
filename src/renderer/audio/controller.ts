import { INITIAL_RECORDING_STATE, MAX_RECORDING_MS, recordingBusy, type RecordingState } from '../../shared/recording';
import type { WindowsState } from '../../shared/windows';

export interface AudioCapture {
  finish(): Promise<Blob>;
  cancel(): void;
}
export interface AudioBackend {
  open(deviceId: string, onLevel: (level: number) => void, onFailure: (message: string) => void, signal: AbortSignal): Promise<AudioCapture>;
}
interface Active {
  id: string; abort: AbortController; lastSoundAt?: number; limitReached?: boolean; capture?: AudioCapture; accepted: boolean; ending: boolean; openedAt?: number;
  timer?: ReturnType<typeof setInterval>; openingTimer?: ReturnType<typeof setTimeout>;
}
export class RecordingController {
  private state: RecordingState = { ...INITIAL_RECORDING_STATE };
  private listeners = new Set<() => void>();
  private active?: Active;
  private clip: Blob | null = null;
  private nativeRevision = -1;
  private lastNativeSession: string | null = null;
  constructor(private backend: AudioBackend, private now = () => performance.now(), private onLimit?: () => void) {}
  getState = () => this.state;
  getClip = () => this.clip;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<RecordingState>) {
    this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }
  begin(id: string, deviceId: string, mode: RecordingState['mode'], accepted = true): boolean {
    if (this.active || recordingBusy(this.state)) return false;
    this.clip = null;
    const active: Active = { id, accepted, ending: false, abort: new AbortController() };
    this.active = active;
    this.update({ ...INITIAL_RECORDING_STATE, sessionId: id, phase: 'opening', mode, message: 'Opening your microphone...' });
    active.openingTimer = setTimeout(() => this.fail(id, 'The microphone did not open in time. Check its permission and try again.'), 15_000);
    void this.backend.open(deviceId, level => {
      if (this.active !== active || active.ending) return;
      if (level >= 2) active.lastSoundAt = this.now();
      this.update({ level, quiet: active.lastSoundAt !== undefined && this.now() - active.lastSoundAt > 3000 });
    }, message => this.fail(id, message), active.abort.signal).then(capture => {
      if (this.active !== active || active.ending) { capture.cancel(); return; }
      clearTimeout(active.openingTimer);
      active.capture = capture; active.openedAt = this.now(); active.lastSoundAt = active.openedAt;
      this.update({ phase: active.accepted ? 'recording' : 'opening', message: active.accepted ? 'Listening. Recording on this computer.' : 'Microphone ready. Recognizing your shortcut...' });
      active.timer = setInterval(() => {
        if (this.active !== active || active.ending || active.openedAt === undefined) return;
        const durationMs = Math.min(MAX_RECORDING_MS, Math.round(this.now() - active.openedAt));
        this.update({ durationMs });
        if (durationMs >= MAX_RECORDING_MS && !active.limitReached) {
          active.limitReached = true;
          if (this.onLimit) this.onLimit(); else void this.finish(id);
        }
      }, 100);
    }, () => this.fail(id, 'Could not open the microphone. Check Windows access and the selected input.'));
    return true;
  }
  accept(id: string, mode: RecordingState['mode']) {
    const active = this.active;
    if (!active || active.id !== id || active.ending) return;
    active.accepted = true;
    this.update({ mode, ...(active.capture ? { phase: 'recording', message: 'Listening. Recording on this computer.' } : {}) });
  }
  async finish(id = this.state.sessionId): Promise<void> {
    const active = this.active;
    if (!active || active.id !== id || active.ending) return;
    if (!active.capture || active.openedAt === undefined) {
      this.fail(active.id, 'The microphone was not ready before you finished. Start again and wait for Listening.');
      return;
    }
    if (!active.accepted) { this.cancel(id); return; }
    active.ending = true; clearInterval(active.timer); clearTimeout(active.openingTimer);
    this.update({ phase: 'finishing', level: 0, durationMs: Math.min(MAX_RECORDING_MS, Math.round(this.now() - active.openedAt)), quiet: false, message: 'Collecting the last audio...' });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const blob = await Promise.race([active.capture.finish(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Final audio timed out')), 5000);
      })]);
      if (this.active !== active) return;
      if (!blob.size) throw new Error('Empty audio');
      active.capture.cancel(); active.abort.abort(); this.active = undefined; this.clip = blob;
      this.update({ phase: 'ready', clip: { bytes: blob.size, mimeType: blob.type }, message: 'Recording ready. Play it below or send it for transcription.' });
    } catch {
      this.fail(active.id, 'The final audio could not be collected. This clip was discarded. Try a new recording.');
    } finally { clearTimeout(timeout); }
  }
  cancel(id = this.state.sessionId) {
    const active = this.active;
    if (!active || active.id !== id) return;
    this.disposeActive(active); this.clip = null;
    this.update({ phase: 'cancelled', level: 0, quiet: false, clip: null, message: 'Recording cancelled. Audio discarded.' });
  }
  private fail(id: string, message: string) {
    const active = this.active;
    if (!active || active.id !== id) return;
    this.disposeActive(active); this.clip = null;
    this.update({ phase: 'failed', level: 0, quiet: false, clip: null, message });
  }
  private disposeActive(active: Active) {
    this.active = undefined; active.abort.abort(); clearInterval(active.timer); clearTimeout(active.openingTimer);
    active.capture?.cancel();
  }
  clear() {
    if (this.active) this.disposeActive(this.active);
    this.clip = null; this.update({ ...INITIAL_RECORDING_STATE });
  }
  native(state: WindowsState, deviceId: string): boolean {
    if (state.revision <= this.nativeRevision) return true;
    this.nativeRevision = state.revision;
    if (state.purpose !== 'recording' || !state.enabled) {
      if (this.active?.id === this.lastNativeSession) this.cancel();
      return true;
    }
    const id = state.sessionId;
    if (!id) return true;
    if (['pending', 'listening'].includes(state.phase) && id !== this.lastNativeSession) {
      if (!this.begin(id, deviceId, state.mode, state.phase === 'listening')) return false;
      this.lastNativeSession = id;
    }
    if (this.active?.id !== id) return true;
    if (state.phase === 'listening') this.accept(id, state.mode);
    if (state.phase === 'finished' && !this.active.ending) {
      this.update({ target: state.target });
      void this.finish(id);
    }
    if (state.phase === 'cancelled' || state.phase === 'failed') this.cancel(id);
    return true;
  }
}
