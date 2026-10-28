import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Store bridge on Windows x64.');
const framework = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const sdk = path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Windows Kits/10/UnionMetadata');
const version = existsSync(sdk) ? readdirSync(sdk).filter(x => /^10\.\d+\.\d+\.\d+$/.test(x) && existsSync(path.join(sdk,x,'Windows.winmd'))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1) : undefined;
if (!version || !existsSync(path.join(framework,'csc.exe'))) throw new Error('Install Windows 10/11 SDK and .NET Framework build tools to build the Store bridge.');
const refs = ['System.dll','System.Core.dll','System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','System.Runtime.WindowsRuntime.dll', 'System.Runtime.dll','System.Runtime.InteropServices.WindowsRuntime.dll'];
mkdirSync('native/store-updater/dist',{recursive:true});
const result = spawnSync(path.join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+path.resolve('native/store-updater/dist/sargosh-store-updater.exe'),...refs.map(file=>'/r:'+path.join(framework,file)),'/r:'+path.join(sdk,version,'Windows.winmd'),path.resolve('native/store-updater/Program.cs')],{stdio:'inherit',windowsHide:true});
if (result.error || result.status !== 0) throw new Error('Store updater bridge compilation failed.');
console.log('Compiled Store updater bridge with the installed Windows SDK and .NET Framework.');


