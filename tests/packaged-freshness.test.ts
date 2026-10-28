import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPackage } from '@electron/asar';
async function fixture(change?: (directory:string)=>void) {
 const base=path.resolve('work');mkdirSync(base,{recursive:true});const directory=mkdtempSync(path.join(base,'packaged-freshness-'));
 const put=(file:string,text:string)=>{const target=path.join(directory,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,text);};
 try {
  for(const file of ['dist/main/entry.js','dist/main/preload.js','dist/renderer/index.html','assets/app-icon.png']) put('archive/'+file,'fixture '+file);
  put('archive/dist/desktop-config.json',JSON.stringify({SARGOSH_API_URL:'https://api.example.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_public'}));
  cpSync(path.join(directory,'archive/dist'),path.join(directory,'dist'),{recursive:true});
  put('helper/dist/sargosh-helper/sargosh-helper.exe','fixture helper');put('packed/resources/sargosh-helper/sargosh-helper.exe','fixture helper');put('.env','GEMINI_API_KEY=private_fixture_do_not_ship');
  put('native/store-updater/dist/sargosh-store-updater.exe','fixture Store bridge');put('packed/resources/sargosh-store-updater.exe','fixture Store bridge');
  await createPackage(path.join(directory,'archive'),path.join(directory,'packed/resources/app.asar'));
  change?.(directory);
  return execFileSync(process.execPath,[path.resolve('scripts/check-packaged-app.mjs'),path.join(directory,'packed')],{cwd:directory,encoding:'utf8',stdio:'pipe',windowsHide:true});
 } finally {if(!path.resolve(directory).startsWith(base+path.sep+'packaged-freshness-'))throw new Error('Invalid fixture cleanup path');rmSync(directory,{recursive:true,force:true});}
}
it('accepts a package containing the current compiled app and helper',async()=>{expect(await fixture()).toContain('checks passed');});
it('rejects an older compiled file even when all required files exist',async()=>{await expect(fixture(directory=>writeFileSync(path.join(directory,'dist/main/entry.js'),'new compiled code'))).rejects.toThrow('does not match the current build');});
it('rejects a new compiled file absent from an older archive',async()=>{await expect(fixture(directory=>writeFileSync(path.join(directory,'dist/main/microphone-permissions.js'),'new permissions'))).rejects.toThrow('stale or incomplete');});
it('rejects an older helper bundled beside otherwise current app files',async()=>{await expect(fixture(directory=>writeFileSync(path.join(directory,'helper/dist/sargosh-helper/sargosh-helper.exe'),'new helper'))).rejects.toThrow('does not match the current build');});
it('rejects a stale Windows Store bridge beside an otherwise current app',async()=>{await expect(fixture(directory=>writeFileSync(path.join(directory,'native/store-updater/dist/sargosh-store-updater.exe'),'new Store bridge'))).rejects.toThrow('Store updater bridge is missing or stale');});
