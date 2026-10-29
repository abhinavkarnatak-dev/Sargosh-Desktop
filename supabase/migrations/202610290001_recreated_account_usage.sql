-- Apply after the practice and streaming usage migrations. No Render secrets are needed.
-- Accounts are still hard-deleted. Only deleted accounts' current-month audio totals
-- are carried forward, keyed by a private HMAC of their verified email.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists sargosh_private.usage_identity_secret (
 singleton boolean primary key default true check(singleton),
 secret bytea not null
);
insert into sargosh_private.usage_identity_secret(singleton,secret)
values(true,extensions.gen_random_bytes(32)) on conflict do nothing;
alter table sargosh_private.usage_identity_secret enable row level security;
revoke all on sargosh_private.usage_identity_secret from public,anon,authenticated,service_role;

create table if not exists sargosh_private.deleted_account_allowance (
 identity_key bytea not null,
 usage_day date not null,
 seconds bigint not null check(seconds>=0),
 expires_at timestamptz not null,
 primary key(identity_key,usage_day)
);
create index if not exists deleted_allowance_expiry on sargosh_private.deleted_account_allowance(expires_at);
alter table sargosh_private.deleted_account_allowance enable row level security;
revoke all on sargosh_private.deleted_account_allowance from public,anon,authenticated,service_role;

create or replace function sargosh_private.usage_email_key(p_email text)
returns bytea language sql stable security definer set search_path='' as $$
 select extensions.hmac(convert_to('sargosh-allowance-v1:'||lower(btrim(p_email)),'UTF8'),secret,'sha256')
 from sargosh_private.usage_identity_secret where singleton and nullif(btrim(p_email),'') is not null;
$$;

create or replace function sargosh_private.purge_deleted_allowance()
returns void language sql security definer set search_path='' as $$
 delete from sargosh_private.deleted_account_allowance where expires_at<=now();
$$;

create or replace function sargosh_private.account_allowance_totals(p_user_id uuid)
returns table(daily_used bigint,monthly_used bigint)
language sql stable security definer set search_path='' as $$
 with periods as (
  select date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' as day_start,
         date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' as month_start
 ), current_identity as (
  select sargosh_private.usage_email_key(email) as key from auth.users
  where id=p_user_id and email_confirmed_at is not null
 ), usage_rows as (
  select (o.reserved_at at time zone 'UTC')::date as usage_day,o.seconds::bigint
  from sargosh_private.usage_operations o,periods p
  where o.user_id=p_user_id and o.kind='stt' and not o.practice and o.state<>'released'
   and (o.state<>'reserved' or o.reserved_at>=now()-interval '2 minutes') and o.reserved_at>=p.month_start
  union all
  select c.usage_day,c.seconds from sargosh_private.deleted_account_allowance c,current_identity i,periods p
  where c.identity_key=i.key and c.expires_at>now() and c.usage_day>=(p.month_start at time zone 'UTC')::date
 )
 select coalesce(sum(u.seconds) filter(where u.usage_day>=(p.day_start at time zone 'UTC')::date),0)::bigint,
        coalesce(sum(u.seconds),0)::bigint
 from periods p left join usage_rows u on true;
$$;

create or replace function sargosh_private.retain_deleted_allowance()
returns trigger language plpgsql security definer set search_path='' as $$
declare identity bytea;
 month_start timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 expiry timestamptz:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
begin
 -- Serialize with reservations and stream settlement. Do not delete an account
 -- while another device still has an in-flight operation whose charge can change.
 perform pg_advisory_xact_lock(721034891);
 if exists(select 1 from sargosh_private.usage_operations where user_id=old.id and
  ((state='reserved' and reserved_at>=now()-interval '2 minutes') or
   (state='dispatched' and dispatched_at>=now()-case when streaming then interval '8 minutes' else interval '2 minutes' end))) then
  raise exception 'Account activity is still in progress. Try deletion again shortly.';
 end if;
 perform sargosh_private.purge_deleted_allowance();
 if old.email_confirmed_at is null then return old;end if;
 identity:=sargosh_private.usage_email_key(old.email);
 if identity is null then return old;end if;
 insert into sargosh_private.deleted_account_allowance(identity_key,usage_day,seconds,expires_at)
 select identity,(reserved_at at time zone 'UTC')::date,sum(seconds),expiry
 from sargosh_private.usage_operations
 where user_id=old.id and kind='stt' and not practice and state in ('done','dispatched') and reserved_at>=month_start
 group by (reserved_at at time zone 'UTC')::date having sum(seconds)>0
 on conflict(identity_key,usage_day) do update set
  seconds=sargosh_private.deleted_account_allowance.seconds+excluded.seconds,expires_at=excluded.expires_at;
 return old;
end $$;
drop trigger if exists sargosh_retain_deleted_allowance on auth.users;
create trigger sargosh_retain_deleted_allowance before delete on auth.users
for each row execute function sargosh_private.retain_deleted_allowance();

create or replace function public.reserve_usage(p_user_id uuid,p_request_id text,p_kind text,p_fingerprint text,p_seconds integer,p_cost_micro bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare policy sargosh_private.usage_policy; old sargosh_private.usage_operations;
 daily_used bigint; monthly_used bigint; budget_used bigint; reset_at timestamptz;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 month_start timestamptz := date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 perform pg_advisory_xact_lock(721034891);
 if p_kind not in ('stt','cleanup') or p_request_id !~ '^[a-zA-Z0-9-]{1,100}$' or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_seconds<0 or p_seconds>300 or (p_kind='stt' and p_seconds<1)
    or (p_kind='cleanup' and p_seconds<>0) or p_cost_micro<1 or p_cost_micro>1000000 then
   return jsonb_build_object('code','INVALID_USAGE'); end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then return jsonb_build_object('code','AUTH_REQUIRED'); end if;
 select * into policy from sargosh_private.usage_policy where singleton;
 update sargosh_private.usage_operations set state='released',finished_at=now()
 where state='reserved' and reserved_at<now()-interval '2 minutes';
 select * into old from sargosh_private.usage_operations where user_id=p_user_id and request_id=p_request_id and kind=p_kind;
 if found then
   if old.fingerprint<>p_fingerprint then return jsonb_build_object('code','REQUEST_ID_REUSED'); end if;
   if old.state<>'released' then return jsonb_build_object('code',case when old.state='done' then 'ALREADY_PROCESSED' else 'REQUEST_PENDING' end); end if;
 end if;
 if exists(select 1 from sargosh_private.usage_operations where user_id=p_user_id and
   (state='reserved' or (state='dispatched' and dispatched_at>now()-case when streaming then interval '8 minutes' else interval '2 minutes' end))) then return jsonb_build_object('code','BUSY'); end if;
 if (select count(*) from sargosh_private.usage_operations where user_id=p_user_id and kind=p_kind and reserved_at>now()-interval '1 minute')>=20 then
   return jsonb_build_object('code','RATE_LIMIT', 'resetAt',now()+interval '1 minute'); end if;
 select t.daily_used,t.monthly_used into daily_used,monthly_used from sargosh_private.account_allowance_totals(p_user_id) t;
 if p_kind='stt' and daily_used+p_seconds>policy.daily_seconds then
   return jsonb_build_object('code','DAILY_LIMIT','resetAt',day_start+interval '1 day'); end if;
 if p_kind='stt' and monthly_used+p_seconds>policy.monthly_seconds then
   return jsonb_build_object('code','MONTHLY_LIMIT','resetAt',month_start+interval '1 month'); end if;
 select coalesce(sum(cost_micro),0) into budget_used from sargosh_private.usage_operations where kind=p_kind and state<>'released' and reserved_at>=month_start;
 if budget_used+p_cost_micro > (case when p_kind='stt' then policy.stt_budget_micro else policy.cleanup_budget_micro end) then
   return jsonb_build_object('code','SERVICE_BUDGET','resetAt',month_start+interval '1 month'); end if;
 insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state)
 values(p_user_id,p_request_id,p_kind,p_fingerprint,p_seconds,p_cost_micro,'reserved')
 on conflict(user_id,request_id,kind) do update set streaming=false,state='reserved',lease_id=gen_random_uuid(),reserved_at=now(),dispatched_at=null,finished_at=null,seconds=p_seconds,cost_micro=p_cost_micro;
 return (select jsonb_build_object('code','OK','leaseId',lease_id) from sargosh_private.usage_operations where user_id=p_user_id and request_id=p_request_id and kind=p_kind);
end $$;

create or replace function public.account_usage(p_user_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('enabled',exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null),
 'dailyLimitSeconds',p.daily_seconds,'monthlyLimitSeconds',p.monthly_seconds,
 'dailyUsedSeconds',t.daily_used,'monthlyUsedSeconds',t.monthly_used,
 'dailyResetAt',(date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC',
 'monthlyResetAt',(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC')
 from sargosh_private.usage_policy p cross join sargosh_private.account_allowance_totals(p_user_id) t where singleton;
$$;

revoke all on function sargosh_private.usage_email_key(text),sargosh_private.account_allowance_totals(uuid),sargosh_private.retain_deleted_allowance(),sargosh_private.purge_deleted_allowance() from public,anon,authenticated,service_role;
revoke all on function public.reserve_usage(uuid,text,text,text,integer,bigint),public.account_usage(uuid) from public,anon,authenticated;
grant execute on function public.reserve_usage(uuid,text,text,text,integer,bigint),public.account_usage(uuid) to service_role;

-- Supabase Cron is already used by welcome emails. Physical deletion runs hourly;
-- expired entries stop affecting allowance immediately at the UTC monthly reset.
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('sargosh-purge-deleted-allowance','0 * * * *','select sargosh_private.purge_deleted_allowance()');
 else
  raise notice 'Enable pg_cron and run supabase/setup/schedule-usage-retention.sql to schedule expiry cleanup.';
 end if;
end $$;
commit;
