import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
interface Encryption { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export class AuthStorage {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private file: string, private encryption: Encryption) {}
  private run<T>(work: () => Promise<T>) { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result; }
  private async read(): Promise<Record<string, string>> {
    try {
      const encrypted = await readFile(this.file); if (!this.encryption.isEncryptionAvailable()) throw new Error();
      const value = JSON.parse(this.encryption.decryptString(encrypted));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string')) throw new Error();
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('Saved sign-in could not be opened securely.'); }
  }
  private async write(values: Record<string, string>) {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.');
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    await writeFile(temporary, this.encryption.encryptString(JSON.stringify(values)), { flush: true });
    await rename(temporary, this.file);
  }
  getItem(key: string) { return this.run(async () => (await this.read())[key] ?? null); }
  setItem(key: string, value: string) { return this.run(async () => { const data = await this.read(); data[key] = value; await this.write(data); }); }
  removeItem(key: string) { return this.run(async () => { const data = await this.read(); delete data[key]; if (Object.keys(data).length) await this.write(data); else await unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }); }
  drain() { return this.tail; }
}
