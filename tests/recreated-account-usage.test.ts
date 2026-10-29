import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

let db:PGlite;
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333',fp='a'.repeat(64);
beforeAll(async()=>{
 db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
 create table public.test_profiles(user_id uuid references auth.users(id) on delete cascade,first_name text);`);
 for(const name of ['202610260002_usage_limits.sql','202610260003_practice_usage.sql','202610280001_streaming_usage.sql','202610290001_recreated_account_usage.sql','202610290002_practice_streaming.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec(`truncate public.test_profiles,auth.users,sargosh_private.usage_operations,sargosh_private.deleted_account_allowance;
 update sargosh_private.usage_policy set daily_seconds=600,monthly_seconds=6000,stt_budget_micro=15000000,cleanup_budget_micro=5000000;`);
 await signup(first,'Tester@Example.com','email');
});
async function signup(id:string,email:string,provider='google',confirmed=true){
 await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,case when $3 then now() else null end,jsonb_build_object('provider',$4::text))`,[id,email,confirmed,provider]);
}
async function remove(id=first){await db.query('delete from auth.users where id=$1',[id]);}
async function snapshot(id=second){return(await db.query<{r:{enabled:boolean;dailyUsedSeconds:number;monthlyUsedSeconds:number;dailyResetAt:string;monthlyResetAt:string}}>('select public.account_usage($1) r',[id])).rows[0].r;}
async function reserve(id:string,request:string,seconds:number,stream=false){return(await db.query<{r:{code:string;leaseId:string}}>(`select public.${stream?'reserve_stream_usage':'reserve_usage'}($1,$2,'stt',$3,$4,1000) r`,[id,request,fp,seconds])).rows[0].r;}
async function charge(id:string,request:string,seconds:number){
 const r=await reserve(id,request,seconds);expect(r.code).toBe('OK');
 await db.query(`select public.dispatch_usage($1,$2,'stt',$3)`,[id,request,r.leaseId]);
 await db.query(`select public.finish_usage($1,$2,'stt',$3)`,[id,request,r.leaseId]);
}
it('hard-deletes the profile and carries verified-email usage across OTP to Google signup',async()=>{
 await charge(first,'before',240);await db.query('insert into public.test_profiles values($1,$2)',[first,'Test']);await remove();
 expect((await db.query('select * from auth.users')).rows).toHaveLength(0);expect((await db.query('select * from public.test_profiles')).rows).toHaveLength(0);
 await signup(second,' tester@example.com ','google');expect(await snapshot()).toMatchObject({enabled:true,dailyUsedSeconds:240,monthlyUsedSeconds:240});
 expect((await reserve(second,'too-much',300)).code).toBe('OK');
 expect((await reserve(first,'deleted',1)).code).toBe('AUTH_REQUIRED');
});
it('accumulates repeated recreations once without multiplying usage or provider spending',async()=>{
 await charge(first,'a',240);await remove();await signup(second,'tester@example.com');
 await charge(second,'b',60);await remove(second);await signup(third,'tester@example.com','email');
 expect(await snapshot(third)).toMatchObject({dailyUsedSeconds:300,monthlyUsedSeconds:300});
 expect((await db.query<{n:number}>('select sum(cost_micro)::integer n from sargosh_private.usage_operations')).rows[0].n).toBe(2000);
 expect((await db.query('select * from sargosh_private.deleted_account_allowance')).rows).toHaveLength(1);
});
it('enforces the carried daily allowance for batch and streaming reservations',async()=>{
 await charge(first,'a',300);await charge(first,'b',299);await remove();await signup(second,'tester@example.com');
 expect((await reserve(second,'batch',2)).code).toBe('DAILY_LIMIT');expect((await reserve(second,'stream',2,true)).code).toBe('DAILY_LIMIT');
 expect((await reserve(second,'last-second',1,true)).code).toBe('OK');
});
it('resets daily totals at UTC midnight while keeping earlier current-month usage in the monthly limit',async()=>{
 await db.query(`insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state,reserved_at)
 values($1,'yesterday','stt',$2,6000,1000,'done',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'-interval '1 second')`,[first,fp]);
 await remove();await signup(second,'tester@example.com');
 const day=(await db.query<{utc_day:number}>(`select extract(day from now() at time zone 'UTC')::integer as utc_day`)).rows[0].utc_day;
 expect((await snapshot()).dailyUsedSeconds).toBe(0);
 if(day>1){expect((await snapshot()).monthlyUsedSeconds).toBe(6000);expect((await reserve(second,'monthly-batch',1)).code).toBe('MONTHLY_LIMIT');expect((await reserve(second,'monthly-live',1,true)).code).toBe('MONTHLY_LIMIT');}
 else {expect((await snapshot()).monthlyUsedSeconds).toBe(0);expect((await reserve(second,'new-month',1)).code).toBe('OK');}
});
it('uses UTC resets even when the database session timezone is different',async()=>{
 await charge(first,'a',50);await remove();await signup(second,'tester@example.com');
 const utc=await snapshot();
 await db.exec(`set timezone='Pacific/Honolulu'`);
 try{const local=await snapshot();expect(local.dailyUsedSeconds).toBe(50);expect(local.monthlyUsedSeconds).toBe(50);expect(new Date(local.dailyResetAt).getTime()).toBe(new Date(utc.dailyResetAt).getTime());expect(new Date(local.monthlyResetAt).getTime()).toBe(new Date(utc.monthlyResetAt).getTime());}
 finally{await db.exec(`set timezone='UTC'`);}
});
it('keeps other emails, unverified accounts, practice, released and expired reservations separate',async()=>{
 await charge(first,'normal',40);
 await db.query(`insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state,practice,reserved_at)
 values($1,'practice','stt',$2,20,100,'done',true,now()),($1,'released','stt',$2,300,100,'released',false,now()),($1,'stale','stt',$2,300,100,'reserved',false,now()-interval '3 minutes')`,[first,fp]);
 await remove();await signup(second,'different@example.com');expect((await snapshot()).monthlyUsedSeconds).toBe(0);
 await signup(third,'tester@example.com','email',false);expect(await snapshot(third)).toMatchObject({enabled:false,monthlyUsedSeconds:0});
 expect((await reserve(third,'unverified',1)).code).toBe('AUTH_REQUIRED');
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[third]);expect((await snapshot(third)).monthlyUsedSeconds).toBe(40);
});
it('keeps the existing practice RPC free of normal allowance and charges only actual settled stream seconds',async()=>{
 const practice=(await db.query<{r:{code:string;leaseId:string}}>(`select public.reserve_practice_usage($1,'trial','stt',$2,15,100) r`,[first,fp])).rows[0].r;
 expect(practice.code).toBe('OK');
 await db.query(`select public.dispatch_usage($1,'trial','stt',$2)`,[first,practice.leaseId]);
 await db.query(`select public.finish_usage($1,'trial','stt',$2)`,[first,practice.leaseId]);
 expect((await snapshot(first)).dailyUsedSeconds).toBe(0);
 const live=await reserve(first,'live',300,true);
 await db.query(`select public.dispatch_usage($1,'live','stt',$2)`,[first,live.leaseId]);
 await db.query(`select public.finish_stream_usage($1,'live','stt',$2,9,100)`,[first,live.leaseId]);
 const trial=(await db.query<{r:{code:string;leaseId:string}}>(`select public.reserve_practice_stream_usage($1,'practice-live','stt',$2,20,1000) r`,[first,fp])).rows[0].r;
 expect(trial.code).toBe('OK');await db.query(`select public.dispatch_usage($1,'practice-live','stt',$2)`,[first,trial.leaseId]);
 await db.query(`select public.finish_stream_usage($1,'practice-live','stt',$2,2,100)`,[first,trial.leaseId]);
 await remove();await signup(second,'tester@example.com');expect((await snapshot()).dailyUsedSeconds).toBe(9);
});
it('retains only an HMAC, UTC day, used seconds and expiry in the protection table',async()=>{
 await charge(first,'a',50);await remove();
 const row=(await db.query<{key:string;seconds:number;expiry:string}>(`select encode(identity_key,'hex') key,seconds::integer,expires_at::text expiry from sargosh_private.deleted_account_allowance`)).rows[0];
 const secret=(await db.query<{key:string}>(`select encode(secret,'hex') key from sargosh_private.usage_identity_secret`)).rows[0].key;
 expect(row.key).toBe(createHmac('sha256',Buffer.from(secret,'hex')).update('sargosh-allowance-v1:tester@example.com').digest('hex'));
 const columns=(await db.query<{column_name:string}>(`select column_name from information_schema.columns where table_schema='sargosh_private' and table_name='deleted_account_allowance' order by ordinal_position`)).rows.map(x=>x.column_name);
 expect(columns).toEqual(['identity_key','usage_day','seconds','expires_at']);
 expect((await db.query<{ok:boolean}>(`select expires_at=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC' ok from sargosh_private.deleted_account_allowance`)).rows[0].ok).toBe(true);
});
it('ignores expired protection immediately and physically purges it',async()=>{
 await charge(first,'a',50);await remove();await signup(second,'tester@example.com');
 await db.exec(`update sargosh_private.deleted_account_allowance set expires_at=now()-interval '1 second'`);
 expect((await snapshot()).monthlyUsedSeconds).toBe(0);expect((await reserve(second,'fresh',300)).code).toBe('OK');
 await db.exec('select sargosh_private.purge_deleted_allowance()');expect((await db.query('select * from sargosh_private.deleted_account_allowance')).rows).toHaveLength(0);
});
it('cannot delete an account with mutable in-flight charges, then allows deletion after settlement',async()=>{
 const r=await reserve(first,'live',300,true);await db.query(`select public.dispatch_usage($1,'live','stt',$2)`,[first,r.leaseId]);
 await expect(remove()).rejects.toThrow('activity is still in progress');expect((await db.query('select * from auth.users')).rows).toHaveLength(1);
 await db.query(`select public.finish_stream_usage($1,'live','stt',$2,8,100)`,[first,r.leaseId]);await remove();await signup(second,'tester@example.com');
 expect((await snapshot()).monthlyUsedSeconds).toBe(8);
});
it('does not grant clients or the API direct access to protection records or the secret',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  for(const table of ['usage_identity_secret','deleted_account_allowance'])await expect(db.query('select * from sargosh_private.'+table)).rejects.toThrow();
  await expect(db.query(`select sargosh_private.usage_email_key('tester@example.com')`)).rejects.toThrow();
  if(role!=='service_role')await expect(snapshot()).rejects.toThrow();
  else expect((await snapshot(first)).enabled).toBe(true);
  await db.exec('reset role');
 }
});
it('can be reapplied without rotating the secret or losing already protected minutes',async()=>{
 await charge(first,'a',50);await remove();await signup(second,'tester@example.com');
 await db.exec(readFileSync('supabase/migrations/202610290001_recreated_account_usage.sql','utf8'));
 expect((await snapshot()).monthlyUsedSeconds).toBe(50);
});
