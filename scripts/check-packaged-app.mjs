import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { listPackage, extractFile } from '@electron/asar';
const directory=path.resolve(process.argv[2] || 'out/Sargosh-win32-x64');
const archive=path.join(directory,'resources','app.asar');
function verifyTree(source, destination) {
 for (const entry of readdirSync(source, {withFileTypes:true})) {
  const file=path.join(source,entry.name);
  if(entry.isDirectory()) verifyTree(file,path.join(destination,entry.name));
  else {
   let packaged;
   try { packaged=source.startsWith('dist') ? extractFile(archive,file) : readFileSync(path.join(destination,entry.name)); }
   catch { throw new Error('Packaged app is stale or incomplete: '+file+'. Run npm run make and wait for it to finish.'); }
   if(!readFileSync(file).equals(packaged)) throw new Error('Packaged app does not match the current build: '+file+'. Run npm run make and wait for it to finish.');
  }
 }
}
verifyTree('dist','');
verifyTree(path.join('helper','dist','sargosh-helper'),path.join(directory,'resources','sargosh-helper'));
const storeBridge=path.join('native','store-updater','dist','sargosh-store-updater.exe');
if(!existsSync(storeBridge)||!existsSync(path.join(directory,'resources','sargosh-store-updater.exe'))||!readFileSync(storeBridge).equals(readFileSync(path.join(directory,'resources','sargosh-store-updater.exe'))))throw new Error('The packaged Store updater bridge is missing or stale. Run npm run prepare:desktop and package again.');
const files=listPackage(archive).map(file=>file.replace(/\\/g,'/'));
for(const file of files) {
 const root=file.split('/')[1];
 if(/\/node_modules\/\./.test(file)) throw new Error('Development cache found in app archive.');
 if(!['dist','assets','node_modules','package.json'].includes(root)) throw new Error('Unexpected file in app archive: '+file);
}
for(const file of ['dist/main/entry.js','dist/main/preload.js','dist/renderer/index.html','assets/app-icon.png','dist/desktop-config.json']) extractFile(archive,file.split('/').join(path.sep));
const config=JSON.parse(extractFile(archive,path.join('dist','desktop-config.json')).toString());
if(Object.keys(config).sort().join(',')!=='SARGOSH_API_URL,SUPABASE_PUBLISHABLE_KEY,SUPABASE_URL' || !config.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) throw new Error('Invalid public configuration.');
const environment=parseEnv(readFileSync('.env','utf8'));
const privateValues=Object.entries(environment).filter(([key,value])=>/KEY|TOKEN|SECRET|PASSWORD/.test(key) && key!=='SUPABASE_PUBLISHABLE_KEY' && value.length>=12).map(([,value])=>Buffer.from(value));
const data=readFileSync(archive);
if(privateValues.some(value=>data.includes(value))) throw new Error('A private credential was found in the app archive.');
if(!existsSync(path.join(directory,'resources','sargosh-helper','sargosh-helper.exe'))) throw new Error('Missing bundled helper.');
console.log('Packaged archive, icons, preload, renderer, public config, helper, and private-credential exclusion checks passed.');
