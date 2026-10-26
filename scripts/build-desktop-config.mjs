import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
let environment={...process.env};
try{environment={...parseEnv(readFileSync('.env','utf8')),...process.env};}catch{}
const url=new URL(environment.SARGOSH_API_URL??'');
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Set SARGOSH_API_URL to the hosted HTTPS origin before preparing desktop configuration.');
const authUrl = new URL(environment.SUPABASE_URL ?? '');
if(authUrl.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(authUrl.hostname) || authUrl.username || authUrl.password || authUrl.pathname !== '/' || authUrl.search || authUrl.hash || !/^sb_publishable_[A-Za-z0-9_-]{10,500}$/.test(environment.SUPABASE_PUBLISHABLE_KEY ?? '')) throw new Error('Use the Supabase HTTPS project URL and public sb_publishable key. Server keys must never be packaged.');
mkdirSync('dist',{recursive:true});
writeFileSync('dist/desktop-config.json',JSON.stringify({SARGOSH_API_URL:url.origin,SUPABASE_URL:authUrl.origin,SUPABASE_PUBLISHABLE_KEY:environment.SUPABASE_PUBLISHABLE_KEY},null,2));
console.log('Public desktop configuration written. No provider or server keys are included.');
