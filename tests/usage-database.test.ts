import { beforeAll,afterAll,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
let db:PGlite;
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',fp='a'.repeat(64);
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 insert into auth.users values('${user}',now()),('${other}',now());`);
 await db.exec(readFileSync('supabase/migrations/202610260002_usage_limits.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610280001_streaming_usage.sql','utf8'));
},20000);
afterAll(async()=>{await db?.close();});
async function reserve(id:string,seconds=100,owner=user,kind='stt',cost=1000){return (await db.query<{result:{code:string;leaseId:string;resetAt?:string}}>("select public.reserve_usage($1,$2,$3,$4,$5,$6) result",[owner,id,kind,fp,seconds,cost])).rows[0].result;}
async function dispatch(id:string,lease:string,owner=user){return(await db.query<{ok:boolean}>("select public.dispatch_usage($1,$2,'stt',$3) ok",[owner,id,lease])).rows[0].ok;}
async function done(id:string,lease:string){await db.query("select public.finish_usage($1,$2,'stt',$3)",[user,id,lease]);}
async function reset(){await db.exec('truncate sargosh_private.usage_operations;update sargosh_private.usage_policy set daily_seconds=600,monthly_seconds=6000,stt_budget_micro=15000000,cleanup_budget_micro=5000000;');}
it('reserves atomically, rejects duplicate/different IDs, and does not allow stale leases',async()=>{
 await reset();const first=await reserve('one');expect(first.code).toBe('OK');expect((await reserve('one')).code).toBe('REQUEST_PENDING');expect((await reserve('two')).code).toBe('BUSY');
 expect(await dispatch('one','00000000-0000-4000-8000-000000000000')).toBe(false);expect(await dispatch('one',first.leaseId)).toBe(true);expect(await dispatch('one',first.leaseId)).toBe(false);await done('one',first.leaseId);expect((await reserve('one')).code).toBe('ALREADY_PROCESSED');
 const changed=await db.query<{r:{code:string}}>("select public.reserve_usage($1,'one','stt',$2,100,1000) r",[user,'b'.repeat(64)]);expect(changed.rows[0].r.code).toBe('REQUEST_ID_REUSED');
});
it('enforces daily and monthly time before paid work and keeps accounts independent',async()=>{
 await reset();for(const id of ['one','two']){const r=await reserve(id,300);await dispatch(id,r.leaseId);await done(id,r.leaseId);}
 expect((await reserve('three',1)).code).toBe('DAILY_LIMIT');expect((await reserve('other',300,other)).code).toBe('OK');
 await db.exec("update sargosh_private.usage_operations set reserved_at=now()-interval '1 day';update sargosh_private.usage_policy set monthly_seconds=600;");expect((await reserve('three',1)).code).toBe('MONTHLY_LIMIT');
});
it('enforces separate service budgets across accounts',async()=>{
 await reset();await db.exec('update sargosh_private.usage_policy set stt_budget_micro=1000,cleanup_budget_micro=2000;');
 const r=await reserve('one',1,user,'stt',1000);await dispatch('one',r.leaseId);await done('one',r.leaseId);
 expect((await reserve('two',1,other,'stt',1)).code).toBe('SERVICE_BUDGET');expect((await reserve('clean',0,other,'cleanup',2000)).code).toBe('OK');
});
it('recovers only unsubmitted reservations and retains uncertain provider usage',async()=>{
 await reset();const first=await reserve('one');await db.exec("update sargosh_private.usage_operations set reserved_at=now()-interval '3 minutes';");
 const retry=await reserve('one');expect(retry.code).toBe('OK');expect(retry.leaseId).not.toBe(first.leaseId);
 const oldRelease=await db.query<{ok:boolean}>("select public.release_usage($1,'one','stt',$2) ok",[user,first.leaseId]);expect(oldRelease.rows[0].ok).toBe(false);
 await dispatch('one',retry.leaseId);await db.exec("update sargosh_private.usage_operations set dispatched_at=now()-interval '3 minutes';");expect((await reserve('one')).code).toBe('REQUEST_PENDING');
 const release=await db.query<{ok:boolean}>("select public.release_usage($1,'one','stt',$2) ok",[user,retry.leaseId]);expect(release.rows[0].ok).toBe(false);
});
it('releases unsubmitted work and reports fixed UTC resets',async()=>{
 await reset();const r=await reserve('one');await db.query("select public.release_usage($1,'one','stt',$2)",[user,r.leaseId]);
 const value=(await db.query<{r:{dailyUsedSeconds:number;dailyResetAt:string;monthlyResetAt:string}}>("select public.account_usage($1) r",[user])).rows[0].r;
 expect(value.dailyUsedSeconds).toBe(0);expect(new Date(value.dailyResetAt).getUTCHours()).toBe(0);expect(new Date(value.monthlyResetAt).getUTCDate()).toBe(1);
});
it('blocks the 21st rapid request, not the 21st account',async()=>{
 await reset();for(let i=0;i<20;i++){const r=await reserve('rate-'+i,1);await dispatch('rate-'+i,r.leaseId);await done('rate-'+i,r.leaseId);}
 expect((await reserve('rate-last',1)).code).toBe('RATE_LIMIT');
 for(let i=0;i<25;i++){const uid=`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`;await db.query('insert into auth.users values($1,now())',[uid]);expect((await reserve('new',1,uid)).code).toBe('OK');}
});
it('keeps usage records server-only and blocks unverified accounts',async()=>{
 await reset();const result=await db.query<{blocked:boolean}>("select not has_function_privilege('authenticated','public.reserve_usage(uuid,text,text,text,integer,bigint)','EXECUTE') blocked");expect(result.rows[0].blocked).toBe(true);
 expect((await reserve('no-user',1,'44444444-4444-4444-8444-444444444444')).code).toBe('AUTH_REQUIRED');
});

it('retains spending totals after account deletion and rejects further reservations for that ID', async () => {
 await reset();
 const deleted='33333333-3333-4333-8333-333333333333';
 await db.query('insert into auth.users values($1,now())',[deleted]);
 const lease=await reserve('delete-check',10,deleted,'stt',1000);
 expect(lease.code).toBe('OK'); await dispatch('delete-check',lease.leaseId,deleted);
 await db.query("select public.finish_usage($1,'delete-check','stt',$2)",[deleted,lease.leaseId]);
 await db.query('delete from auth.users where id=$1',[deleted]);
 expect((await db.query<{cost:number}>('select sum(cost_micro)::integer cost from sargosh_private.usage_operations')).rows[0].cost).toBe(1000);
 expect((await reserve('after-delete',1,deleted)).code).toBe('AUTH_REQUIRED');
});

it('settles a reserved live window to server-counted seconds without accepting stale leases or excess costs',async()=>{
 await reset();
 const result=(await db.query<{r:{code:string;leaseId:string}}>("select public.reserve_stream_usage($1,'live','stt',$2,300,46000) r",[user,fp])).rows[0].r;
 expect(result.code).toBe('OK');await dispatch('live',result.leaseId);
 await db.exec("update sargosh_private.usage_operations set dispatched_at=now()-interval '3 minutes'");
 expect((await reserve('while-live',1)).code).toBe('BUSY');
 const settle=async(lease:string,seconds:number,cost:number)=>(await db.query<{ok:boolean}>("select public.finish_stream_usage($1,'live','stt',$2,$3,$4) ok",[user,lease,seconds,cost])).rows[0].ok;
 expect(await settle('00000000-0000-4000-8000-000000000000',7,1074)).toBe(false);
 expect(await settle(result.leaseId,301,46001)).toBe(false);
 expect(await settle(result.leaseId,7,1074)).toBe(true);
 expect(await settle(result.leaseId,0,0)).toBe(false);
 const usage=(await db.query<{r:{dailyUsedSeconds:number}}>("select public.account_usage($1) r",[user])).rows[0].r;
 expect(usage.dailyUsedSeconds).toBe(7);
 expect((await reserve('after-live',1)).code).toBe('OK');
 const permission=await db.query<{blocked:boolean}>("select not has_function_privilege('authenticated','public.finish_stream_usage(uuid,text,text,uuid,integer,bigint)','EXECUTE') blocked");expect(permission.rows[0].blocked).toBe(true);
});
