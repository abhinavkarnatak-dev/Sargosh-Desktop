import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Helper } from '../src/main/helper';
describe('Electron-to-Python message bridge', () => {
  it('round-trips preferences and rejects unsupported commands', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sargosh-helper-test-'));
    const helper = new Helper();
    try {
      await helper.start(process.cwd(), directory);
      expect(helper.ready).toBe(true);
      expect(await helper.call('windows.status')).toMatchObject({ enabled: false, purpose: 'input-test' });
      await expect(helper.call('windows.arm', { shortcut: 'Control+Alt+Space', purpose: 'invalid' })).rejects.toThrow('Local operation failed');
      await helper.call('preferences', { theme: 'dark' });
      const snapshot = await helper.call<{ preferences: { theme: string }; history: unknown[] }>('snapshot');
      expect(snapshot.preferences.theme).toBe('dark');
      expect(snapshot.history).toEqual([]);
      await expect(helper.call('arbitrary-command')).rejects.toThrow('Local operation failed');
    } finally {
      await helper.stop();
      if (!directory.startsWith(path.join(os.tmpdir(), 'sargosh-helper-test-'))) throw new Error('Unexpected test directory');
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
