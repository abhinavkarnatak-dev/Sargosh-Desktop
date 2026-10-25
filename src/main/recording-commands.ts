import { randomUUID } from 'node:crypto';
export interface RecordingCommand { id: string; action: 'cancel' | 'finish' }
// The overlay must hear back from the renderer that owns the microphone.
export class RecordingCommands {
  private pending = new Map<string, { owner: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  run(owner: number, action: RecordingCommand['action'], send: (command: RecordingCommand) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => this.settle(owner, id, false), 6500);
      this.pending.set(id, { owner, resolve, reject, timer });
      try { send({ id, action }); } catch { this.settle(owner, id, false); }
    });
  }
  settle(owner: number, id: string, ok: boolean) {
    const request = this.pending.get(id);
    if (!request || request.owner !== owner) return;
    this.pending.delete(id); clearTimeout(request.timer);
    if (ok) request.resolve(); else request.reject(new Error('The recording window did not complete the control. Restart Sargosh.'));
  }
  cancelAll() {
    for (const [id, request] of this.pending) this.settle(request.owner, id, false);
  }
}
