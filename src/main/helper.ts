import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export class Helper {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  ready = false;
  async start(root: string, dataDir: string): Promise<void> {
    this.child = spawn(process.env.SARGOSH_PYTHON || 'python', [path.join(root, 'helper', 'main.py'), '--data-dir', dataDir], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    const fail = () => {
      this.ready = false;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Local helper is unavailable.')); }
      this.pending.clear();
    };
    this.child.on('error', fail); this.child.on('exit', fail);
    this.child.stderr.on('data', () => console.error('The local helper reported an error.'));
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const response = JSON.parse(line) as { id: number; error?: string; result?: unknown };
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id); clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(response.error)); else pending.resolve(response.result);
      } catch { fail(); this.child?.kill(); }
    });
    await this.call('ping');
    this.ready = true;
  }
  call<T>(method: string, params: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed || !this.child.stdin.writable) { reject(new Error('Local helper is unavailable.')); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The local helper did not respond.')); }, 5000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
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
