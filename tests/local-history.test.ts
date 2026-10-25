import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rename, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { Helper } from '../src/main/helper';
import { LocalHistory } from '../src/main/history';
import { countWords } from '../src/shared/history';
import type { HistoryEntry, Snapshot } from '../src/shared/types';
const id = '11111111-1111-4111-8111-111111111111';
const base = path.resolve('work', 'history-tests');
let directory: string; let helper: Helper; let archive: LocalHistory; const changed = vi.fn();
const buffer = () => Uint8Array.from([1, 2, 3, 4]).buffer;
const capture = () => archive.capture({ id, audio: buffer(), mimeType: 'audio/webm;codecs=opus', language: 'en', cleanupEnabled: true }, { createdAt: '2026-10-25T12:00:00.000Z', durationMs: 2000 });
const complete = (text = 'Hello world') => archive.update({ id, text, originalText: 'Original words', language: 'en', cleanupEnabled: true, status: 'completed' });
beforeEach(async () => {
  changed.mockClear(); await mkdir(base, { recursive: true }); directory = await mkdtemp(path.join(base, 'case-')); helper = new Helper(); await helper.start(process.cwd(), directory);
  archive = new LocalHistory(path.join(directory, 'recordings'), helper, changed); await archive.initialize();
});
afterEach(async () => {
  await archive.drain(); await helper.stop();
  if (path.dirname(path.resolve(directory)) !== base || !path.basename(directory).startsWith('case-')) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
it('persists original audio and transcript across a real Python/SQLite restart', async () => {
  await capture(); await complete(); await helper.stop();
  helper = new Helper(); await helper.start(process.cwd(), directory);
  archive = new LocalHistory(path.join(directory, 'recordings'), helper, changed); await archive.initialize();
  const page = await archive.list(); expect(page.entries[0]).toMatchObject({ id, text: 'Hello world', originalText: 'Original words', audioBytes: 4, language: 'en', cleanupEnabled: true });
  expect(new Uint8Array((await archive.audio(id)).audio)).toEqual(new Uint8Array(buffer()));
});
it('counts a recording once and preserves its first earned metrics on retry and deletion', async () => {
  await capture(); await complete(); await complete('Hello new world');
  let snapshot = await helper.call<Snapshot>('snapshot'); expect(snapshot.totalWords).toBe(2); expect(snapshot.recordingCount).toBe(1); expect(snapshot.history[0].text).toBe('Hello new world');
  await archive.remove(id); await complete('Late result'); snapshot = await helper.call<Snapshot>('snapshot');
  expect(snapshot.history).toEqual([]); expect(snapshot.totalWords).toBe(2); await expect(access(path.join(directory, 'recordings', id + '.audio'))).rejects.toThrow();
});
it('deduplicates captures and rejects a changed audio body for an existing recording', async () => {
  await Promise.all([capture(), capture()]); expect((await archive.list()).entries).toHaveLength(1);
  await expect(archive.capture({ id, audio: Uint8Array.from([9]).buffer, mimeType: 'audio/webm', language: 'en', cleanupEnabled: true }, { createdAt: new Date().toISOString(), durationMs: 1 })).rejects.toThrow('identity');
});
it('keeps previous successful text when a later attempt fails', async () => {
  await capture(); await complete();
  await archive.update({ id, text: '', originalText: '', language: 'en', cleanupEnabled: true, status: 'failed', error: 'Provider unavailable' });
  expect((await archive.get(id))?.text).toBe('Hello world');
});
it('exports exact original bytes without changing history', async () => {
  await capture(); const destination = path.join(directory, 'export.webm'); await archive.exportAudio(id, destination);
  expect(await readFile(destination)).toEqual(Buffer.from(buffer())); expect((await archive.list()).entries).toHaveLength(1);
});
it('rejects traversal and missing audio without touching arbitrary files', async () => {
  await expect(archive.audio('../secret')).rejects.toThrow('Invalid'); await capture();
  await rename(path.join(directory, 'recordings', id + '.audio'), path.join(directory, 'missing.audio'));
  await expect(archive.audio(id)).rejects.toThrow(); await archive.remove(id); expect((await archive.list()).entries).toEqual([]);
});
it('restores interrupted deletions and removes uncommitted recording files at startup', async () => {
  await capture(); await rename(path.join(directory, 'recordings', id + '.audio'), path.join(directory, 'recordings', id + '.deleted'));
  const other = '22222222-2222-4222-8222-222222222222';
  await writeFile(path.join(directory, 'recordings', other + '.audio'), 'orphan');
  await writeFile(path.join(directory, 'recordings', other + '.tmp'), 'partial'); await archive.initialize();
  expect((await archive.audio(id)).audio.byteLength).toBe(4);
  await expect(access(path.join(directory, 'recordings', other + '.audio'))).rejects.toThrow();
  await expect(access(path.join(directory, 'recordings', other + '.tmp'))).rejects.toThrow();
});
it('pages older entries without duplicates when timestamps match', async () => {
  for (let index = 0; index < 52; index++) {
    const rowId = index.toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111';
    await helper.call('history.create', { entry: { id: rowId, createdAt: '2026-10-25T12:00:00.000Z', text: 'Text', originalText: '', words: 1, durationMs: 1, status: 'completed', error: null, language: 'en', cleanupEnabled: true, audioMimeType: '', audioBytes: 0 } });
  }
  const first = await archive.list(); const last = first.entries.at(-1)!;
  const next = await archive.list({ id: last.id, createdAt: last.createdAt });
  expect(first.entries).toHaveLength(50); expect(first.hasMore).toBe(true); expect(next.entries).toHaveLength(2); expect(next.hasMore).toBe(false);
  expect(new Set([...first.entries, ...next.entries].map(row => row.id)).size).toBe(52);
});
it('counts Hindi and English words while excluding punctuation and emoji', () => { expect(countWords('Hello, world! नमस्ते दोस्त 👋')).toBe(4); });

it('can read and delete a legacy text-only entry without requiring a recording file', async () => {
  await helper.call('history.create', { entry: { id: 'old-recording', createdAt: '2026-10-25T12:00:00Z', text: 'Older words', originalText: '', words: 2, durationMs: 1000, status: 'completed', error: null, language: 'en', cleanupEnabled: true, audioMimeType: '', audioBytes: 0 } });
  expect((await archive.get('old-recording'))?.text).toBe('Older words');
  await archive.remove('old-recording'); expect(await archive.get('old-recording')).toBeNull();
});

it('persists long transcripts containing escaped characters through the real helper', async () => {
  await capture();
  const text = ['Hi ', String.fromCharCode(34, 92, 10)].join('').repeat(4000);
  await archive.update({ id, text, originalText: text, language: 'en', cleanupEnabled: true, status: 'completed' });
  expect((await archive.get(id))?.text).toBe(text);
});
