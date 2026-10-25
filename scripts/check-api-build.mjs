import { execFileSync } from 'node:child_process';
import { cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const work=path.resolve(root,'work');mkdirSync(work,{recursive:true});
const directory=mkdtempSync(path.join(work,'api-build-smoke-'));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this check with npm run test:api-build.');
try {
 for(const name of ['package.json','package-lock.json'])cpSync(path.join(root,'deploy/api',name),path.join(directory,name));
 cpSync(path.join(root,'tsconfig.server.json'),path.join(directory,'tsconfig.server.json'));
 for(const name of ['server','shared'])cpSync(path.join(root,'src',name),path.join(directory,'src',name),{recursive:true});
 const lock=JSON.parse(readFileSync(path.join(directory,'package-lock.json'),'utf8'));
 if(Object.entries(lock.packages??{}).some(([name,value])=>name.startsWith('..')||value.link||String(value.resolved??'').startsWith('file:')))throw new Error('The API lockfile must not reference the desktop repository or local files.');
 const run=(args)=>execFileSync(process.execPath,args,{cwd:directory,stdio:'inherit',windowsHide:true});
 run([npm,'ci','--include=dev','--ignore-scripts','--no-audit','--no-fund']);
 run([path.join(directory,'node_modules/typescript/bin/tsc'),'-p','tsconfig.server.json']);
 run([npm,'prune','--omit=dev','--ignore-scripts','--no-audit','--no-fund']);
 run(['-e',"require('./dist-api/server/app.js'); console.log('Standalone API runtime loaded.');"]);
 console.log('Isolated API install, build, and production dependency checks passed.');
} finally {
 const resolved=path.resolve(directory);
 if(path.dirname(resolved)===work&&path.basename(resolved).startsWith('api-build-smoke-'))rmSync(resolved,{recursive:true,force:true});
}
