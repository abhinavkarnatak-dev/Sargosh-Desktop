-- Integration checks for a disposable local PostgreSQL instance only.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}'::jsonb);
\ir ../migrations/202610260001_welcome_email.sql
-- Migration timestamp is before these test accounts, matching real later signups.
begin;
insert into auth.users values('00000000-0000-4000-8000-000000000001','old@example.com',now(),now()-interval '1 day','{"first_name":"Old"}');
insert into auth.users values('00000000-0000-4000-8000-000000000002','otp@example.com',null,clock_timestamp(),'{"first_name":"Priya"}');
insert into auth.users values('00000000-0000-4000-8000-000000000003','unnamed@example.com',now(),clock_timestamp(),'{}');
insert into auth.users values('00000000-0000-4000-8000-000000000004','google@example.com',now(),clock_timestamp(),'{"full_name":"Ravi Sharma"}');
do $$ begin
 if (select count(*) from public.welcome_emails)<>1 then raise exception 'Eligibility filtering failed'; end if;
 if (select first_name from public.welcome_emails)<>'Ravi' then raise exception 'Google name failed'; end if;
end $$;
update auth.users set email_confirmed_at=now() where email='otp@example.com';
update auth.users set raw_user_meta_data='{"first_name":"Ananya"}' where email='unnamed@example.com';
update auth.users set raw_user_meta_data='{"first_name":"Changed"}' where email='google@example.com';
do $$ begin
 if (select count(*) from public.welcome_emails)<>3 then raise exception 'Verified/name updates failed'; end if;
 if (select first_name from public.welcome_emails where email='google@example.com')<>'Ravi' then raise exception 'Stable retry payload failed'; end if;
 if has_table_privilege('authenticated','public.welcome_emails','SELECT') then raise exception 'Client can read emails'; end if;
 if not (select relrowsecurity from pg_class where oid='sargosh_private.welcome_config'::regclass) then raise exception 'Config RLS missing'; end if;
 if not (select relrowsecurity from pg_class where oid='public.welcome_emails'::regclass) then raise exception 'Email RLS missing'; end if;
 if has_schema_privilege('authenticated','sargosh_private','USAGE') then raise exception 'Private schema accessible'; end if;
 if has_table_privilege('anon','sargosh_private.welcome_config','SELECT') then raise exception 'Config readable'; end if;
 if has_function_privilege('anon','public.claim_welcome_emails()','EXECUTE') then raise exception 'Public worker access'; end if;
end $$;
create temporary table claimed as select * from public.claim_welcome_emails();
do $$ begin
 if (select count(*) from claimed)<>3 then raise exception 'Claim failed'; end if;
 if (select count(*) from public.claim_welcome_emails())<>0 then raise exception 'Active leases claimed twice'; end if;
 if public.finish_welcome_email((select user_id from claimed limit 1),gen_random_uuid(),'wrong') then raise exception 'Stale lease accepted'; end if;
end $$;
select public.finish_welcome_email(user_id,lease_id,'provider-id') from claimed where email='google@example.com';
select public.fail_welcome_email(user_id,lease_id,'provider_http_429',true) from claimed where email='otp@example.com';
select public.fail_welcome_email(user_id,lease_id,'provider_http_422',false) from claimed where email='unnamed@example.com';
do $$ begin
 if (select status from public.welcome_emails where email='google@example.com')<>'sent' then raise exception 'Acceptance not saved'; end if;
 if (select status from public.welcome_emails where email='otp@example.com')<>'pending' then raise exception 'Retry not scheduled'; end if;
 if (select count(*) from public.claim_welcome_emails())<>0 then raise exception 'Retry cooldown ignored'; end if;
 if (select status from public.welcome_emails where email='unnamed@example.com')<>'failed' then raise exception 'Permanent rejection retried'; end if;
end $$;
update public.welcome_emails set next_attempt_at=now()-interval '1 minute' where email='otp@example.com';
create temporary table retry as select * from public.claim_welcome_emails();
do $$ begin
 if (select attempts from retry)<>2 then raise exception 'Retry count wrong'; end if;
 if (select lease_id from retry)=(select lease_id from claimed where email='otp@example.com') then raise exception 'Lease reused'; end if;
end $$;
-- Expired leases recover, but uncertain sends outside the safe window require review.
update public.welcome_emails set lease_until=now()-interval '1 minute' where email='otp@example.com';
do $$ begin if (select count(*) from public.claim_welcome_emails())<>1 then raise exception 'Crash recovery failed'; end if; end $$;
update public.welcome_emails set first_attempt_at=now()-interval '21 hours',lease_until=now()-interval '1 minute' where email='otp@example.com';
select count(*) from public.claim_welcome_emails();
do $$ begin
 if (select status from public.welcome_emails where email='otp@example.com')<>'review' then raise exception 'Unsafe late retry'; end if;
end $$;
-- A changed/unverified destination must not receive the queued email.
insert into auth.users values('00000000-0000-4000-8000-000000000005','changed@example.com',now(),clock_timestamp(),'{"first_name":"Changed"}');
update auth.users set email='new@example.com',email_confirmed_at=null where email='changed@example.com';
select count(*) from public.claim_welcome_emails();
do $$ begin
 if (select last_error from public.welcome_emails where email='changed@example.com')<>'account_changed' then raise exception 'Old destination was sent'; end if;
end $$;
-- A crashed worker at the attempt limit cannot keep retrying indefinitely.
insert into auth.users values('00000000-0000-4000-8000-000000000006','limit@example.com',now(),clock_timestamp(),'{"first_name":"Limit"}');
update public.welcome_emails set attempts=5,status='processing',lease_until=now()-interval '1 minute' where email='limit@example.com';
select count(*) from public.claim_welcome_emails();
do $$ begin if (select status from public.welcome_emails where email='limit@example.com')<>'review' then raise exception 'Retry limit ignored'; end if; end $$;
-- Account deletion removes its queue record.
delete from auth.users where email='limit@example.com';
do $$ begin if exists(select 1 from public.welcome_emails where email='limit@example.com') then raise exception 'Deleted account retained'; end if; end $$;
rollback;
