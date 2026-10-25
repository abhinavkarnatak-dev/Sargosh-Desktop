import { mkdir, readFile, writeFile, rename, unlink, readdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Helper } from './helper';
import type { HistoryEntry } from '../shared/types';
import { countWords, isHistoryId, type HistoryCapture, type HistoryCursor, type HistoryPage, type HistoryResult } from '../shared/history';
import { audioType, isSpeechLanguage, isRequestId } from '../shared/transcription';
import { MAX_AUDIO_BYTES, MAX_RECORDING_MS } from '../shared/recording';
import { localDate } from '../shared/insights';
export class LocalHistory {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private store: Pick<Helper, 'call'>, private changed: () => void) {}
  private file(id: string, suffix = '.audio') { if (!isHistoryId(id)) throw new Error('Invalid recording.'); return path.join(this.directory, id + suffix); }
  private run<T>(work: () => Promise<T>): Promise<T> { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result; }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      const match = /^([a-f0-9-]{36})\.(tmp|deleted|audio)$/.exec(name); if (!match || !isHistoryId(match[1])) continue;
      const entry = await this.store.call<HistoryEntry | null>('history.get', { id: match[1] });
      if (match[2] === 'deleted' && entry) await rename(this.file(match[1], '.deleted'), this.file(match[1]));
      else if (match[2] !== 'audio' || !entry) await unlink(this.file(match[1], '.' + match[2]));
    }
  }
  capture(request: HistoryCapture, meta: { createdAt: string; durationMs: number }) {
    return this.run(async () => {
      if (!request || !isHistoryId(request.id) || !(request.audio instanceof ArrayBuffer) || !request.audio.byteLength || request.audio.byteLength > MAX_AUDIO_BYTES || (typeof request.mimeType !== 'string' || !audioType(request.mimeType)) || !isSpeechLanguage(request.language) || typeof request.cleanupEnabled !== 'boolean' || !Number.isFinite(meta.durationMs) || meta.durationMs < 0 || meta.durationMs > MAX_RECORDING_MS || !Number.isFinite(Date.parse(meta.createdAt))) throw new Error('Invalid recording.');
      const current = await this.get(request.id);
      if (current) {
        if (current.audioMimeType !== request.mimeType || !(await readFile(this.file(request.id))).equals(Buffer.from(request.audio))) throw new Error('Recording identity already exists.');
        return;
      }
      try {
        await writeFile(this.file(request.id, '.tmp'), Buffer.from(request.audio), { flag: 'wx', flush: true });
        await rename(this.file(request.id, '.tmp'), this.file(request.id));
        await this.store.call('history.create', { entry: { id: request.id, ...meta, text: '', originalText: '', words: 0, status: 'pending', error: null, language: request.language, cleanupEnabled: request.cleanupEnabled, audioMimeType: request.mimeType, audioBytes: request.audio.byteLength } });
      } catch (error) {
        await unlink(this.file(request.id, '.tmp')).catch(() => {});
        await unlink(this.file(request.id)).catch(() => {});
        throw error;
      }
      this.changed();
    });
  }
  get(id: string) { if (!isRequestId(id)) return Promise.reject(new Error('Invalid recording.')); return this.store.call<HistoryEntry | null>('history.get', { id }); }
  list(cursor?: HistoryCursor): Promise<HistoryPage> {
    if (cursor && (!isRequestId(cursor.id) || !Number.isFinite(Date.parse(cursor.createdAt)))) return Promise.reject(new Error('Invalid history page.'));
    return this.store.call('history.list', { cursor });
  }
  update(result: HistoryResult) {
    return this.run(async () => {
      if (!result || !isHistoryId(result.id) || typeof result.text !== 'string' || result.text.length > 24000 || typeof result.originalText !== 'string' || result.originalText.length > 24000 || !isSpeechLanguage(result.language) || typeof result.cleanupEnabled !== 'boolean' || !['completed', 'failed'].includes(result.status) || result.error !== undefined && (typeof result.error !== 'string' || result.error.length > 400)) throw new Error('Invalid transcript.');
      const current = await this.get(result.id); if (!current) return;
      const completed = result.status === 'completed' && !!result.text.trim();
      if (current.status === 'completed' && !completed) return;
      await this.store.call('history.update', { entry: { ...result, status: completed ? 'completed' : 'failed', words: completed ? countWords(result.text) : 0, error: result.error ?? (completed ? null : 'No speech was recognized.') }, day: localDate(new Date(current.createdAt)) });
      this.changed();
    });
  }
  audio(id: string) {
    return this.run(async () => {
      const entry = await this.get(id); if (!entry?.audioMimeType || !entry.audioBytes) throw new Error('Original recording is unavailable.');
      const metadata = await stat(this.file(id)); if (metadata.size !== entry.audioBytes || metadata.size > MAX_AUDIO_BYTES) throw new Error('Original recording is unavailable.');
      const data = await readFile(this.file(id)); if (data.byteLength > MAX_AUDIO_BYTES || data.byteLength !== entry.audioBytes) throw new Error('Original recording is unavailable.');
      return { audio: Uint8Array.from(data).buffer, mimeType: entry.audioMimeType };
    });
  }
  remove(id: string) {
    return this.run(async () => {
      const entry = await this.get(id); if (!entry) return;
      if (!entry.audioBytes) { await this.store.call('delete', { id }); this.changed(); return; }
      let moved = false;
      try { await rename(this.file(id), this.file(id, '.deleted')); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      try { await this.store.call('delete', { id }); } catch (error) { if (moved) await rename(this.file(id, '.deleted'), this.file(id)); throw error; }
      if (moved) {
        try { await unlink(this.file(id, '.deleted')); }
        catch (error) {
          await this.store.call('history.create', { entry: { ...entry, error: entry.error ?? null } });
          await rename(this.file(id, '.deleted'), this.file(id));
          throw error;
        }
      }
      this.changed();
    });
  }
  exportAudio(id: string, destination: string) { return this.run(async () => { if (!await this.get(id)) throw new Error('Recording is unavailable.'); await copyFile(this.file(id), destination); }); }
  drain() { return this.tail; }
}
