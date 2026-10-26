import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const executable = path.resolve(process.argv[2] || 'helper/dist/sargosh-helper/sargosh-helper.exe');
const dataDir = path.resolve('work/helper-packaged-smoke');
mkdirSync(dataDir, { recursive: true });
const calls = [
 {id:1,method:'ping',params:{}},
 {id:2,method:'snapshot',params:{}},
 {id:3,method:'windows.arm',params:{shortcut:'Control+Alt+F12',ignoredProcessIds:[process.pid]}},
 {id:4,method:'windows.disarm',params:{}}
];
const result = spawnSync(executable, ['--data-dir', dataDir], { input:calls.map(value=>JSON.stringify(value)).join('\n')+'\n', encoding:'utf8', windowsHide:true, timeout:30000, env:{...process.env,PYTHONHOME:'',PYTHONPATH:'',PYTHONIOENCODING:'utf-8'} });
if(result.error || result.status!==0) { console.error(result.stderr); throw new Error('Bundled helper process failed.'); }
const replies=result.stdout.trim().split('\n').map(line=>JSON.parse(line)).filter(value=>value.id);
if(replies.length!==4 || replies.some(value=>value.error) || !replies.find(value=>value.id===3)?.result.enabled || replies.find(value=>value.id===4)?.result.enabled) throw new Error('Bundled helper could not open local storage or Windows input access.');
console.log('Bundled Python runtime, SQLite, UI Automation, keyboard hook, and clean shutdown passed. No recording or text insertion occurred.');
