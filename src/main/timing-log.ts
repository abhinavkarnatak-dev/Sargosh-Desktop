import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeTiming, type TimingSink } from '../shared/timing';

// Best-effort, bounded diagnostics: two files of at most roughly 2 MiB each.
export function createTimingLog(directory: string, appVersion: string): TimingSink {
  const file = path.join(directory, 'dictation-timing.jsonl');
  const maxBytes = 2 * 1024 * 1024;
  let queue = Promise.resolve(); let pending = 0; let initialized = false; let bytes = 0;
  return input => {
    const event = safeTiming(input); if (!event) return;
    const line = JSON.stringify({ ...event, appVersion, recordedAt: new Date().toISOString() }) + '\n';
    try { console.info(line.trimEnd()); } catch { /* Logging cannot interrupt recording. */ }
    if (pending >= 256) return;
    pending++;
    queue = queue.then(async () => {
      if (!initialized) {
        await mkdir(directory, { recursive: true });
        bytes = await stat(file).then(value => value.size).catch(() => 0); initialized = true;
      }
      const size = Buffer.byteLength(line);
      if (bytes + size > maxBytes) {
        await rm(file + '.1', { force: true }); await rename(file, file + '.1'); bytes = 0;
      }
      await appendFile(file, line, 'utf8'); bytes += size;
    }).catch(() => { initialized = false; }).finally(() => { pending--; });
  };
}
