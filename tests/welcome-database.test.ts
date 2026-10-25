import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
it('runs the real welcome migration and account/lease/retry checks in PostgreSQL',async()=>{
 const db=new PGlite();
 try {
   const migration=readFileSync('supabase/migrations/202610260001_welcome_email.sql','utf8');
   const checks=readFileSync('supabase/tests/welcome-email.sql','utf8').replace(/^\\set.*$/gm,'').replace(/^\\ir.*$/gm,()=>migration);
   await db.exec(checks);
 } finally { await db.close(); }
},20000);

it('diagnoses a healthy worker with only pre-existing accounts without returning secrets',async()=>{
 const db=new PGlite();
 try {
   const checks=readFileSync('supabase/tests/welcome-email.sql','utf8');
   await db.exec(checks.split('\\ir')[0].replace(/^\\set.*$/gm,''));
   await db.exec("insert into auth.users values(gen_random_uuid(),'private@example.com',now(),now()-interval '1 day','{\"first_name\":\"Private\"}');");
   await db.exec(readFileSync('supabase/migrations/202610260001_welcome_email.sql','utf8'));
   await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
     insert into vault.decrypted_secrets values('welcome_worker_token','private-fixture-token'),('welcome_worker_url','https://fixture.supabase.co/functions/v1/send-welcome');
     create schema cron;create table cron.job(jobid bigint,jobname text,active boolean);create table cron.job_run_details(jobid bigint,status text,start_time timestamptz);
     insert into cron.job values(1,'sargosh-welcome-email',true);insert into cron.job_run_details values(1,'succeeded',now());
     create schema net;create table net._http_response(status_code integer,timed_out boolean,created timestamptz,content text);
     insert into net._http_response values(200,false,now(),'{}');`);
   const result=await db.query<{welcome_diagnostics:{queue:unknown[];signup:{new_accounts:number};http:{status_code:number}[]}}>(readFileSync('supabase/setup/diagnose-welcome.sql','utf8'));
   expect(result.rows[0].welcome_diagnostics.queue).toEqual([]);expect(result.rows[0].welcome_diagnostics.signup.new_accounts).toBe(0);expect(result.rows[0].welcome_diagnostics.http[0].status_code).toBe(200);
   expect(JSON.stringify(result.rows)).not.toContain('private-fixture-token');expect(JSON.stringify(result.rows)).not.toContain('private@example.com');
 } finally { await db.close(); }
},20000);
