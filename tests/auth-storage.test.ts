import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { AuthStorage } from '../src/main/auth-storage';
it('serializes encrypted session writes without dropping concurrent keys and removes signed-out secrets', async () => {
  const base = path.resolve('work/auth-tests'); await mkdir(base, { recursive: true }); const directory = await mkdtemp(path.join(base,'case-'));
  const key = randomBytes(32); const nonce = randomBytes(12);
  const encryption = { isEncryptionAvailable: () => true,
    encryptString(value: string) { const cipher = createCipheriv('aes-256-gcm',key,nonce); const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return Buffer.concat([cipher.getAuthTag(),data]); },
    decryptString(value: Buffer) { const cipher=createDecipheriv('aes-256-gcm',key,nonce); cipher.setAuthTag(value.subarray(0,16)); return Buffer.concat([cipher.update(value.subarray(16)),cipher.final()]).toString('utf8'); }
  };
  try {
    const file = path.join(directory,'session.bin'); const store = new AuthStorage(file,encryption);
    await Promise.all([store.setItem('session','private-refresh-token'),store.setItem('pkce','private-verifier')]);
    expect((await readFile(file)).includes(Buffer.from('private-refresh-token'))).toBe(false);
    const reopened = new AuthStorage(file,encryption); expect(await reopened.getItem('session')).toBe('private-refresh-token'); expect(await reopened.getItem('pkce')).toBe('private-verifier');
    await reopened.removeItem('session'); expect(await reopened.getItem('pkce')).toBe('private-verifier'); await reopened.removeItem('pkce'); await expect(readFile(file)).rejects.toThrow();
    const unavailable = new AuthStorage(file,{...encryption,isEncryptionAvailable:()=>false}); await expect(unavailable.setItem('session','secret')).rejects.toThrow('secure storage'); await expect(readFile(file)).rejects.toThrow();
  } finally { if(path.dirname(directory)!==base) throw new Error('Invalid test path'); await rm(directory,{recursive:true,force:true}); }
});
