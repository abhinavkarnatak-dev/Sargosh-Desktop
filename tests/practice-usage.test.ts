import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
let db: PGlite;
const user='11111111-1111-4111-8111-111111111111', fp='a'.repeat(64);
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,created_at timestamptz,raw_user_meta_data jsonb);
 insert into auth.users values('${user}',now(),'2026-10-27T00:00:00Z','{}');`);
 for(const file of ['202610260002_usage_limits.sql','202610260003_practice_usage.sql','202610280001_streaming_usage.sql','202610290002_practice_streaming.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
},20000);
afterAll(async()=>{await db?.close();});
async function reserve(id:string,kind='stt',seconds=10,cost=1000,practice=true){return(await db.query<{r:{code:string;leaseId:string}}>(`select public.${practice?'reserve_practice_usage':'reserve_usage'}($1,$2,$3,$4,$5,$6) r`,[user,id,kind,fp,seconds,cost])).rows[0].r;}
async function finish(id:string,kind:string,lease:string){await db.query('select public.dispatch_usage($1,$2,$3,$4)',[user,id,kind,lease]);await db.query('select public.finish_usage($1,$2,$3,$4)',[user,id,kind,lease]);}
async function reset(){await db.exec(`truncate sargosh_private.usage_operations;update auth.users set raw_user_meta_data='{}';update sargosh_private.usage_policy set stt_budget_micro=15000000;`);}
it('keeps practice out of daily/monthly allowance while charging provider spend and normal dictation correctly',async()=>{
 await reset();const r=await reserve('practice');expect(r.code).toBe('OK');await finish('practice','stt',r.leaseId);
 const c=await reserve('practice','cleanup',0);expect(c.code).toBe('OK');await finish('practice','cleanup',c.leaseId);
 let usage=(await db.query<{r:{dailyUsedSeconds:number;monthlyUsedSeconds:number}}>('select public.account_usage($1) r',[user])).rows[0].r;
 expect(usage.dailyUsedSeconds).toBe(0);expect(usage.monthlyUsedSeconds).toBe(0);
 const normal=await reserve('normal','stt',15,1000,false);await finish('normal','stt',normal.leaseId);
 usage=(await db.query<{r:typeof usage}>('select public.account_usage($1) r',[user])).rows[0].r;expect(usage.dailyUsedSeconds).toBe(15);expect(usage.monthlyUsedSeconds).toBe(15);
 expect((await db.query<{cost:number}>('select sum(cost_micro)::integer cost from sargosh_private.usage_operations')).rows[0].cost).toBe(3000);
});
it('limits free practice to three attempts and 20 seconds, without resetting after metadata edits',async()=>{
 await reset();expect((await reserve('long','stt',21)).code).toBe('INVALID_USAGE');
 for(let i=0;i<3;i++){const r=await reserve('trial-'+i);await finish('trial-'+i,'stt',r.leaseId);}
 expect((await reserve('fourth')).code).toBe('PRACTICE_LIMIT');
 await db.exec(`update auth.users set raw_user_meta_data='{"sargosh_onboarding_version":1}';`);expect((await reserve('complete')).code).toBe('PRACTICE_UNAVAILABLE');
 await db.exec(`update auth.users set raw_user_meta_data='{}';`);expect((await reserve('cleared')).code).toBe('PRACTICE_LIMIT');
 expect((await reserve('ordinary','stt',10,1000,false)).code).toBe('OK');
});
it('requires a completed practice transcription for cleanup and enforces shared spending caps',async()=>{
 await reset();expect((await reserve('unpaired','cleanup',0)).code).toBe('PRACTICE_UNAVAILABLE');
 const r=await reserve('trial');await finish('trial','stt',r.leaseId);
 await db.exec('update sargosh_private.usage_policy set stt_budget_micro=1000');expect((await reserve('budget')).code).toBe('SERVICE_BUDGET');
 expect((await reserve('trial')).code).toBe('ALREADY_PROCESSED');
});
it('does not expose the practice reservation RPC to desktop/public database roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await expect(reserve('blocked')).rejects.toThrow();await db.exec('reset role');}
});

async function reserveLive(id:string,seconds=20,cost=3067){return(await db.query<{r:{code:string;leaseId:string}}>(`select public.reserve_practice_stream_usage($1,$2,'stt',$3,$4,$5) r`,[user,id,fp,seconds,cost])).rows[0].r;}
async function settleLive(id:string,lease:string,seconds:number,cost:number){await db.query(`select public.dispatch_usage($1,$2,'stt',$3)`,[user,id,lease]);return(await db.query<{ok:boolean}>(`select public.finish_stream_usage($1,$2,'stt',$3,$4,$5) ok`,[user,id,lease,seconds,cost])).rows[0].ok;}
it('streams practice with exhausted normal limits without deducting minutes, while charging actual audio and cleanup costs',async()=>{
 await reset();await db.query(`insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state) values($1,'normal','stt',$2,6000,1000,'done')`,[user,fp]);
 const before=(await db.query<{r:unknown}>('select public.account_usage($1) r',[user])).rows[0].r;
 const r=await reserveLive('live');expect(r.code).toBe('OK');expect(await settleLive('live',r.leaseId,2,307)).toBe(true);
 const c=await reserve('live','cleanup',0,500);expect(c.code).toBe('OK');await finish('live','cleanup',c.leaseId);
 expect((await db.query<{r:unknown}>('select public.account_usage($1) r',[user])).rows[0].r).toEqual(before);
 expect((await db.query<{cost:number}>('select sum(cost_micro)::integer cost from sargosh_private.usage_operations')).rows[0].cost).toBe(1807);
 expect((await db.query<{practice:boolean;streaming:boolean}>(`select practice,streaming from sargosh_private.usage_operations where request_id='live' and kind='stt'`)).rows[0]).toEqual({practice:true,streaming:true});
});
it('shares the same three-attempt cap between batch and streaming practice and rejects excessive audio',async()=>{
 await reset();expect((await reserveLive('too-long',21)).code).toBe('INVALID_USAGE');
 const batch=await reserve('batch');await finish('batch','stt',batch.leaseId);
 for(const id of ['live-1','live-2']){const r=await reserveLive(id);expect(r.code).toBe('OK');expect(await settleLive(id,r.leaseId,1,154)).toBe(true);}
 expect((await reserveLive('fourth')).code).toBe('PRACTICE_LIMIT');expect((await reserve('fifth')).code).toBe('PRACTICE_LIMIT');
});
it('charges cancelled paid practice but releases an unstarted attempt, and obeys shared budgets and setup eligibility',async()=>{
 await reset();const empty=await reserveLive('empty');await db.query(`select public.release_usage($1,'empty','stt',$2)`,[user,empty.leaseId]);
 for(let i=0;i<3;i++){const r=await reserveLive('partial-'+i);expect(r.code).toBe('OK');await settleLive('partial-'+i,r.leaseId,1,154);}
 expect((await reserveLive('exhausted')).code).toBe('PRACTICE_LIMIT');
 await reset();await db.exec('update sargosh_private.usage_policy set stt_budget_micro=3000');expect((await reserveLive('budget')).code).toBe('SERVICE_BUDGET');
 await reset();await db.exec(`update auth.users set raw_user_meta_data='{"sargosh_onboarding_version":1}'`);expect((await reserveLive('completed')).code).toBe('PRACTICE_UNAVAILABLE');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await expect(reserveLive('public')).rejects.toThrow();await db.exec('reset role');}
});
