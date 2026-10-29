import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses the Windows SDK IInitializeWithWindow interface ID for StoreContext',()=>{
  // Microsoft documents this IID for the .NET Framework desktop Store bridge.
  // A different IID makes the COM cast fail before any update check can run.
  const source=readFileSync('native/store-updater/Program.cs','utf8');
  const declaration=source.match(/\[ComImport, Guid\("([A-F0-9-]+)"\), InterfaceType\(ComInterfaceType.InterfaceIsIUnknown\)\]\s*internal interface IInitializeWithWindow/);
  expect(declaration?.[1]).toBe('3E68D4BD-7135-4D10-8018-9FB6D9F33FA1');
});
