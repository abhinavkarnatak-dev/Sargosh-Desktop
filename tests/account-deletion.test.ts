import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AccountDeletion } from '../src/main/account-deletion';
const user = '11111111-1111-4111-8111-111111111111';
const base = path.resolve('work/account-deletion-tests');
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) { if (path.dirname(directory) !== base) throw new Error('Invalid test path'); await rm(directory, { recursive: true, force: true }); } });
async function fixture() { await mkdir(base, { recursive: true }); const directory = await mkdtemp(path.join(base, 'case-')); directories.push(directory); return path.join(directory, 'cleanup.json'); }
it('deletes remotely before removing local data, clears the session, and retains no journal after success', async () => {
  const journal = await fixture(), purge = vi.fn(async () => {}), forget = vi.fn(async () => {});
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => { expect(init?.body).toBe(JSON.stringify({ confirmation: 'DELETE' })); expect(init?.headers).toMatchObject({ Authorization: 'Bearer session-token' }); expect(purge).not.toHaveBeenCalled(); return Response.json({ deleted: true }); });
  await new AccountDeletion(journal, purge, forget, fetcher).remove('https://api.test', user, 'session-token');
  expect(purge).toHaveBeenCalledWith(user); expect(forget).toHaveBeenCalledOnce();
  expect(purge.mock.invocationCallOrder[0]).toBeLessThan(forget.mock.invocationCallOrder[0]);
  await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('keeps local data and session when remote deletion fails', async () => {
  const purge = vi.fn(), forget = vi.fn();
  await expect(new AccountDeletion(await fixture(), purge, forget, async () => Response.json({}, { status: 503 })).remove('https://api.test', user, 'token')).rejects.toThrow('could not be confirmed');
  expect(purge).not.toHaveBeenCalled(); expect(forget).not.toHaveBeenCalled();
});
it('retries interrupted local cleanup from disk without sending another deletion request', async () => {
  const journal = await fixture(), forget = vi.fn(async () => {});
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ deleted: true }));
  await expect(new AccountDeletion(journal, async () => { throw new Error('locked'); }, forget, fetcher).remove('https://api.test', user, 'token')).rejects.toThrow('cloud account was deleted');
  expect(JSON.parse(await readFile(journal, 'utf8'))).toEqual({ userId: user });
  const purge = vi.fn(async () => {});
  await new AccountDeletion(journal, purge, forget, fetcher).recover();
  expect(purge).toHaveBeenCalledWith(user); expect(fetcher).toHaveBeenCalledOnce(); expect(forget).toHaveBeenCalledOnce();
});
it('rejects corrupted cleanup IDs without touching local data', async () => {
  const journal = await fixture(); await writeFile(journal, JSON.stringify({ userId: '../other-account' }));
  const purge = vi.fn(); await expect(new AccountDeletion(journal, purge, async () => {}).recover()).rejects.toThrow('Invalid account'); expect(purge).not.toHaveBeenCalled();
});

it('still clears local data if the cleanup journal cannot be written', async () => {
  const journal = path.join(await fixture(), 'missing-parent', 'journal.json');
  const purge = vi.fn(async () => {}), forget = vi.fn(async () => {});
  await new AccountDeletion(journal, purge, forget, async () => Response.json({ deleted: true })).remove('https://api.test', user, 'token');
  expect(purge).toHaveBeenCalledWith(user); expect(forget).toHaveBeenCalledOnce();
});
