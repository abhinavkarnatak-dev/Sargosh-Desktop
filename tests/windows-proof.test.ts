import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function configuration(...flags: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/windows-proof.ts', ...flags, '--check-config'], {
    encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout;
}

describe('Windows proof command configuration', () => {
  it('makes tracking-only mode explicit without starting native hooks', () => {
    const output = configuration();
    expect(output).toContain('Automatic insertion: DISABLED');
    expect(output).toContain('npm run test:windows:insert');
    expect(output).not.toContain('Windows input test: ready');
  });

  it('enables fixed-text delivery when the insertion option reaches the runner', () => {
    const output = configuration('--insert-on-finish');
    expect(output).toContain('Automatic insertion: ENABLED');
    expect(output).not.toContain('Windows input test: ready');
  });
});
