import type { DesktopBridge } from '../shared/types';
import type { WindowsState } from '../shared/windows';
type ShortcutBridge = Pick<DesktopBridge, 'windowsStatus' | 'windowsAction' | 'startWindowsRecording' | 'startWindowsTest'>;

// Keep shortcut hooks paused while collecting keys, then restore their previous mode.
export class ShortcutSession {
  private tail: Promise<unknown> = Promise.resolve();
  private resumeState: WindowsState | null = null;
  private value = '';
  private closed = false;
  constructor(private bridge: ShortcutBridge | undefined, private persist: (value: string) => Promise<void>, private isBusy: () => boolean) {}
  private run<T>(work: () => Promise<T>) { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result; }
  begin() { return this.run(async () => {
    if (this.closed) return;
    if (this.isBusy()) throw new Error('Finish the current dictation before changing the shortcut.');
    if (!this.bridge) return;
    const state = await this.bridge.windowsStatus();
    if (['pending', 'listening'].includes(state.phase)) throw new Error('Finish the current dictation before changing the shortcut.');
    if (state.enabled) {
      this.resumeState = state; this.value = state.shortcut;
      const stopped = await this.bridge.windowsAction('disarm');
      if (stopped.enabled) throw new Error('Could not pause the current shortcut. Please try again.');
    }
  }); }
  save(value: string) { return this.run(async () => {
    if (this.closed) return;
    await this.persist(value); this.value = value;
    try { await this.resume(); }
    catch { throw new Error('Shortcut saved, but it could not be enabled. Close Settings and use Try again on Dictation.'); }
  }); }
  cancel() { return this.run(() => this.resume()); }
  dispose() { this.closed = true; return this.run(() => this.resume()); }
  private async resume() {
    if (!this.resumeState || !this.bridge) return;
    const previous = this.resumeState;
    const current = await this.bridge.windowsStatus();
    // Another explicit action may have already enabled a shortcut. Do not replace it.
    if (!current.enabled) {
      const next = previous.purpose === 'recording' ? await this.bridge.startWindowsRecording(this.value) : await this.bridge.startWindowsTest(this.value);
      if (!next.enabled) throw new Error('Could not resume shortcuts.');
    }
    this.resumeState = null;
  }
}
