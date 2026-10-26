-- Run the ENTIRE file in SQL Editor, after replacing the email placeholder.
-- No provider calls are made. Every test change is rolled back at the end.
-- Finish any active dictation on your test account before running this.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
do $checks$
declare
 test_user uuid;
 day_used integer;
 month_used integer;
 spent bigint;
 outcome jsonb;
 prefix text := 'limit-check-'||gen_random_uuid()::text;
 fingerprint text := repeat('a',64);
 month_start timestamptz := date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select id into test_user from auth.users
 where lower(email)=lower('YOUR_SIGN_IN_EMAIL_HERE') and email_confirmed_at is not null;
 if test_user is null then raise exception 'Replace the email placeholder with your verified Sargosh sign-in email.'; end if;
 perform pg_advisory_xact_lock(721034891);
 if exists(select 1 from sargosh_private.usage_operations where user_id=test_user and
   ((state='reserved' and reserved_at>now()-interval '2 minutes') or (state='dispatched' and dispatched_at>now()-interval '2 minutes'))) then
   raise exception 'Finish the current dictation, wait two minutes if necessary, then run this check again.';
 end if;
 update sargosh_private.usage_operations set state='released' where user_id=test_user and state='reserved' and reserved_at<now()-interval '2 minutes';
 select coalesce(sum(seconds) filter(where reserved_at>=day_start),0),coalesce(sum(seconds),0)
 into day_used,month_used from sargosh_private.usage_operations
 where user_id=test_user and kind='stt' and not practice and state<>'released' and reserved_at>=month_start;

 -- Give the test account one second of remaining daily allowance, then request two.
 update sargosh_private.usage_policy set daily_seconds=day_used+1,
 monthly_seconds=greatest(month_used+10000,day_used+10000),stt_budget_micro=1000000000,cleanup_budget_micro=1000000000 where singleton;
 outcome:=public.reserve_usage(test_user,prefix||'-daily','stt',fingerprint,2,2);
 if outcome->>'code'<>'DAILY_LIMIT' then raise exception 'Daily check failed: %',outcome->>'code'; end if;

 -- Model earlier usage this month. On the first UTC day, daily and monthly windows coincide.
 if day_start>month_start then
   insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state,reserved_at)
   values(test_user,prefix||'-history','stt',fingerprint,1000,0,'done',month_start);
   update sargosh_private.usage_policy set daily_seconds=day_used+3,monthly_seconds=month_used+1001 where singleton;
   outcome:=public.reserve_usage(test_user,prefix||'-monthly','stt',fingerprint,2,2);
   if outcome->>'code'<>'MONTHLY_LIMIT' then raise exception 'Monthly check failed: %',outcome->>'code'; end if;
 else
   raise notice 'Monthly-only check skipped because the UTC daily/monthly windows currently coincide.';
 end if;

 -- Give the shared STT budget one microdollar remaining, then request two.
 select coalesce(sum(cost_micro),0) into spent from sargosh_private.usage_operations where kind='stt' and state<>'released' and reserved_at>=month_start;
 update sargosh_private.usage_policy set daily_seconds=1000000,monthly_seconds=1000000,stt_budget_micro=spent+1 where singleton;
 outcome:=public.reserve_usage(test_user,prefix||'-budget','stt',fingerprint,1,2);
 if outcome->>'code'<>'SERVICE_BUDGET' then raise exception 'Shared-budget check failed: %',outcome->>'code'; end if;

 -- A completed request ID cannot start another paid operation.
 insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state)
 values(test_user,prefix||'-duplicate','stt',fingerprint,1,0,'done');
 outcome:=public.reserve_usage(test_user,prefix||'-duplicate','stt',fingerprint,1,1);
 if outcome->>'code'<>'ALREADY_PROCESSED' then raise exception 'Duplicate check failed: %',outcome->>'code'; end if;

 -- A reserved request prevents a second simultaneous request for the same account.
 insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state)
 values(test_user,prefix||'-active','stt',fingerprint,1,0,'reserved');
 outcome:=public.reserve_usage(test_user,prefix||'-busy','stt',fingerprint,1,1);
 if outcome->>'code'<>'BUSY' then raise exception 'Concurrency check failed: %',outcome->>'code'; end if;
 raise notice 'Usage limit checks passed. All test changes will now be rolled back.';
end $checks$;
rollback;
