import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
let environment={...process.env};
try{environment={...parseEnv(readFileSync('.env','utf8')),...process.env};}catch{}
const url=new URL(environment.SARGOSH_API_URL??'');
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Set SARGOSH_API_URL to the hosted HTTPS origin before preparing desktop configuration.');
if(!environment.SUPABASE_URL||!environment.SUPABASE_PUBLISHABLE_KEY)throw new Error('Supabase public configuration is required.');
mkdirSync('dist',{recursive:true});
writeFileSync('dist/desktop-config.json',JSON.stringify({SARGOSH_API_URL:url.origin,SUPABASE_URL:environment.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:environment.SUPABASE_PUBLISHABLE_KEY},null,2));
console.log('Public desktop configuration written. No provider or server keys are included.');
