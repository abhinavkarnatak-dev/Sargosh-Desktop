import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export class AccountDeletion {
  cloudDeleted = false;
  constructor(private journal: string, private purge: (id: string) => Promise<unknown>, private forget: () => Promise<void>, private fetcher: typeof fetch = fetch) {}
  async recover() {
    let userId: unknown;
    try { userId = JSON.parse(await readFile(this.journal, 'utf8')).userId; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Account cleanup could not be restored.'); }
    if (!validId(userId)) throw new Error('Invalid account cleanup record.');
    await this.purge(userId); await this.forget(); await unlink(this.journal);
  }
  async remove(origin: string, userId: string, token: string) {
    if (!validId(userId) || new URL(origin).protocol !== 'https:') throw new Error('Account deletion requires the hosted service.');
    const response = await this.fetcher(origin + '/v1/account', {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(100000)
    }).catch(() => { throw new Error('Account deletion could not be confirmed. Check your connection before trying again.'); });
    const value = await response.json().catch(() => null);
    if (!response.ok || value?.deleted !== true) throw new Error(response.status === 401 ? 'Sign in again before deleting your account.' : 'Account deletion could not be confirmed. Please try again.');
    this.cloudDeleted = true;
    let recorded = false;
    try {
      await writeFile(this.journal + '.tmp', JSON.stringify({ userId }), { flush: true });
      await rename(this.journal + '.tmp', this.journal);
      recorded = true;
    } catch { /* Still attempt cleanup if the recovery journal cannot be written. */ }
    try {
      if (recorded) await this.recover();
      else { await this.purge(userId); await this.forget(); }
    } catch {
      throw new Error(recorded
        ? 'Your cloud account was deleted. Local cleanup could not finish. Restart Sargosh to retry cleanup.'
        : 'Your cloud account was deleted, but local files could not be removed or scheduled for cleanup. Check local disk access before using Sargosh again.');
    }
  }
}
