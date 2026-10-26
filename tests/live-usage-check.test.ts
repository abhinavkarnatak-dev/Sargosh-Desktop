import { it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
it('runs the operator limit checks without retaining test usage or altered allowances',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   insert into auth.users values('11111111-1111-4111-8111-111111111111','tester@example.com',now());`);
  await db.exec(readFileSync('supabase/migrations/202610260002_usage_limits.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/202610260003_practice_usage.sql','utf8'));
  const before=await db.query('select * from sargosh_private.usage_policy');
  await db.exec(readFileSync('supabase/setup/verify-usage-limits.sql','utf8').replace('YOUR_SIGN_IN_EMAIL_HERE','tester@example.com'));
  expect((await db.query('select * from sargosh_private.usage_policy')).rows).toEqual(before.rows);
  expect((await db.query<{count:number}>('select count(*)::integer count from sargosh_private.usage_operations')).rows[0].count).toBe(0);
 }finally{await db.close();}
},20000);
