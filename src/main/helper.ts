import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { helperCommand } from './helper-command';
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
// ASCII JSON is independent of the packaged Python interpreter's Windows code page.
export const helperMessage = (value: unknown) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => '\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'))+'\n';
export class Helper {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  ready = false;
  private listeners = new Set<(event: string, data: unknown) => void>();
  onEvent(listener: (event: string, data: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async start(root: string, dataDir: string, executable?: string): Promise<void> {
    const launch = helperCommand(root, dataDir, executable);
    this.child = spawn(launch.command, launch.args, {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    const fail = () => {
      const wasReady = this.ready;
      this.ready = false;
      if (wasReady) for (const listener of this.listeners) listener('helper.unavailable', null);
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Local helper is unavailable.')); }
      this.pending.clear();
    };
    this.child.on('error', fail); this.child.on('exit', fail);
    this.child.stderr.on('data', () => console.error('The local helper reported an error.'));
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const response = JSON.parse(line) as { id: number; error?: string; result?: unknown; event?: string; data?: unknown };
        if (response.event === 'windows.state' || response.event === 'windows.delivery-first-input') {
          for (const listener of this.listeners) listener(response.event, response.data);
          return;
        }
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id); clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(response.error)); else pending.resolve(response.result);
      } catch { fail(); this.child?.kill(); }
    });
    await this.call('ping');
    this.ready = true;
  }
  call<T>(method: string, params: unknown = {}, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed || !this.child.stdin.writable) { reject(new Error('Local helper is unavailable.')); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (method.startsWith('windows.')) { this.ready = false; this.child?.kill(); }
        reject(new Error('The local helper did not respond.'));
      }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child.stdin.write(helperMessage({ id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Could not reach the local helper.')); }
      });
    });
  }
  async stop(): Promise<void> {
    this.ready = false;
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.once('error', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
}
