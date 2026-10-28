import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { manifest, storeVersion, payloadFiles, assertPayloadMatches } = await import(pathToFileURL(path.resolve('scripts/msix-utils.mjs')).href);
const identity = JSON.parse(readFileSync('packaging/msix/identity.json', 'utf8'));

it('uses the exact reserved Store identity and four-part version', () => {
  const xml = manifest(identity, '0.1.0');
  expect(xml).toContain('Name="AbhinavKarnatak.Sargosh"');
  expect(xml).toContain('Publisher="CN=802770BA-7032-41C1-B78E-998062099EAB"');
  expect(xml).toContain('<PublisherDisplayName>Abhinav Karnatak</PublisherDisplayName>');
  expect(xml).toContain('Version="0.1.0.0"');
  expect(xml).toContain('Executable="app\\Sargosh.exe"');
  expect(xml).toContain('Name="runFullTrust"');
  expect(xml).toContain('Name="microphone"');
  expect(xml).not.toContain('squirrel');
});
it('escapes XML text and attributes rather than allowing malformed identity markup', () => {
  expect(manifest({ ...identity, publisherDisplayName: 'A & B <team>' }, '1.2.3')).toContain('A &amp; B &lt;team&gt;');
});
it('rejects prerelease strings and out-of-range versions instead of uploading ambiguous Store updates', () => {
  for (const value of ['1.0.0-beta', '1.2', '1.2.3.4', '65536.0.0', '01.0.0']) expect(() => storeVersion(value)).toThrow();
  expect(storeVersion('1.2.3')).toBe('1.2.3.0');
});
it('rejects missing or invalid Store identity', () => {
  expect(() => manifest({ ...identity, publisher: '' }, '0.1.0')).toThrow();
  expect(() => manifest({ ...identity, name: 'invalid/name' }, '0.1.0')).toThrow();
});
function fixture(action: (directory: string) => void) {
  const base = path.resolve('work');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, 'msix-test-'));
  try {
    mkdirSync(path.join(directory, 'source/resources/sargosh-helper'), { recursive: true });
    writeFileSync(path.join(directory, 'source/Sargosh.exe'), 'app');
    writeFileSync(path.join(directory, 'source/resources/sargosh-helper/sargosh-helper.exe'), 'helper');
    cpSync(path.join(directory, 'source'), path.join(directory, 'destination'), { recursive: true });
    action(directory);
  } finally {
    if (!directory.startsWith(base + path.sep + 'msix-test-')) throw new Error('Invalid cleanup path');
    rmSync(directory, { recursive: true, force: true });
  }
}
it('verifies the Python helper remains in the exact app payload', () => fixture(directory => {
  expect(assertPayloadMatches(path.join(directory, 'source'), path.join(directory, 'destination'))).toBe(2);
}));
it('detects an altered helper even when the app executable matches', () => fixture(directory => {
  writeFileSync(path.join(directory, 'destination/resources/sargosh-helper/sargosh-helper.exe'), 'changed');
  expect(() => assertPayloadMatches(path.join(directory, 'source'), path.join(directory, 'destination'))).toThrow('mismatch');
}));
it('rejects additional files in the resulting package payload', () => fixture(directory => {
  writeFileSync(path.join(directory, 'destination/extra.exe'), 'unexpected');
  expect(() => assertPayloadMatches(path.join(directory, 'source'), path.join(directory, 'destination'))).toThrow('file list');
}));
it('refuses installer helpers and private environment files in the MSIX payload', () => fixture(directory => {
  for (const filename of ['squirrel.exe', 'Update.exe', '.env', '.env.production', 'Sargosh_ExecutionStub.exe']) {
    const file = path.join(directory, 'source', filename);
    writeFileSync(file, 'must not ship');
    expect(() => payloadFiles(path.join(directory, 'source'))).toThrow('Unexpected private or installer file');
    rmSync(file);
  }
}));