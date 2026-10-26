import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { helperCommand } from '../src/main/helper-command';
const require = createRequire(import.meta.url);
const forge = require('../forge.config.cjs');
it('packages only app resources and dependencies, excluding private and development files', () => {
  for (const file of ['/package.json', '/dist', '/dist/main/entry.js', '/dist/desktop-config.json', '/node_modules', '/node_modules/koffi/index.cjs', '/assets', '/assets/app-icon.png']) expect(forge.packagerConfig.ignore(file), file).toBe(false);
  for (const file of ['/.env', '/.env.production', '/.venv', '/.git', '/.codex', '/.agents', '/AGENTS.md', '/work', '/.local', '/helper', '/tests', '/src', '/supabase', '/deploy', '/assets/email', '/README.md', '/package-lock.json', '/node_modules/.vite', '/node_modules/.vitest', '/node_modules/.package-lock.json']) expect(forge.packagerConfig.ignore(file), file).toBe(true);
});
it('refuses a missing packaged helper instead of falling back to a computer Python installation', () => {
  expect(() => helperCommand('/fixture', '/data', '/fixture/no-such-helper.exe')).toThrow('Reinstall');
});
it('keeps the source helper available for development', () => {
  expect(helperCommand('/fixture', '/data').args).toEqual([expect.stringContaining('main.py'), '--data-dir', '/data']);
});

it('handles installer events before loading the normal application', () => {
  const entry = readFileSync('src/main/entry.ts', 'utf8');
  for (const installing of [true, false]) {
    const calls: string[] = [];
    runInNewContext(entry, { require: (name: string) => { calls.push(name); return name === 'electron-squirrel-startup' ? installing : undefined; } });
    expect(calls).toEqual(installing ? ['electron-squirrel-startup'] : ['electron-squirrel-startup', './main']);
  }
});