-- V1 usage limits. Accounts are not capped or invite-only. Run after the welcome-email migration.
begin;
create schema if not exists sargosh_private;
revoke all on schema sargosh_private from public,anon,authenticated;
create table if not exists sargosh_private.usage_policy (
 singleton boolean primary key default true check(singleton),
 daily_seconds integer not null default 600 check(daily_seconds>0),
 monthly_seconds integer not null default 6000 check(monthly_seconds>=daily_seconds),
 stt_budget_micro bigint not null default 15000000 check(stt_budget_micro>0),
 cleanup_budget_micro bigint not null default 5000000 check(cleanup_budget_micro>0)
);
alter table sargosh_private.usage_policy enable row level security;
revoke all on sargosh_private.usage_policy from public,anon,authenticated,service_role;
insert into sargosh_private.usage_policy(singleton) values(true) on conflict do nothing;
create table if not exists sargosh_private.usage_operations (
 user_id uuid not null, -- Retain anonymous usage IDs when accounts are deleted to preserve budget totals.
 request_id text not null,
 kind text not null check(kind in ('stt','cleanup')),
 lease_id uuid not null default gen_random_uuid(),
 fingerprint text not null,
 seconds integer not null,
 cost_micro bigint not null,
 state text not null check(state in ('reserved','dispatched','done','released')),
 reserved_at timestamptz not null default now(),
 dispatched_at timestamptz,
 finished_at timestamptz,
 primary key(user_id,request_id,kind)
);
create index if not exists usage_period on sargosh_private.usage_operations(reserved_at);
alter table sargosh_private.usage_operations enable row level security;
revoke all on sargosh_private.usage_operations from public,anon,authenticated,service_role;

create or replace function public.reserve_usage(p_user_id uuid,p_request_id text,p_kind text,p_fingerprint text,p_seconds integer,p_cost_micro bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare policy sargosh_private.usage_policy; old sargosh_private.usage_operations;
 daily_used bigint; monthly_used bigint; budget_used bigint; reset_at timestamptz;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 month_start timestamptz := date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 -- One short global transaction lock protects both account and overall budgets across instances.
 perform pg_advisory_xact_lock(721034891);
 if p_kind not in ('stt','cleanup') or p_request_id !~ '^[a-zA-Z0-9-]{1,100}$' or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_seconds<0 or p_seconds>300 or (p_kind='stt' and p_seconds<1)
    or (p_kind='cleanup' and p_seconds<>0) or p_cost_micro<1 or p_cost_micro>1000000 then
   return jsonb_build_object('code','INVALID_USAGE'); end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then return jsonb_build_object('code','AUTH_REQUIRED'); end if;
 select * into policy from sargosh_private.usage_policy where singleton;
 -- Reservations that never dispatched are safe to release. Dispatched/uncertain calls remain charged.
 update sargosh_private.usage_operations set state='released',finished_at=now()
 where state='reserved' and reserved_at<now()-interval '2 minutes';
 select * into old from sargosh_private.usage_operations where user_id=p_user_id and request_id=p_request_id and kind=p_kind;
 if found then
   if old.fingerprint<>p_fingerprint then return jsonb_build_object('code','REQUEST_ID_REUSED'); end if;
   if old.state<>'released' then return jsonb_build_object('code',case when old.state='done' then 'ALREADY_PROCESSED' else 'REQUEST_PENDING' end); end if;
 end if;
 if exists(select 1 from sargosh_private.usage_operations where user_id=p_user_id and
   (state='reserved' or (state='dispatched' and dispatched_at>now()-interval '2 minutes'))) then return jsonb_build_object('code','BUSY'); end if;
 if (select count(*) from sargosh_private.usage_operations where user_id=p_user_id and kind=p_kind and reserved_at>now()-interval '1 minute')>=20 then
   return jsonb_build_object('code','RATE_LIMIT', 'resetAt',now()+interval '1 minute'); end if;
 select coalesce(sum(seconds) filter(where reserved_at>=day_start),0),coalesce(sum(seconds),0)
 into daily_used,monthly_used from sargosh_private.usage_operations where user_id=p_user_id and kind='stt' and state<>'released' and reserved_at>=month_start;
 if p_kind='stt' and daily_used+p_seconds>policy.daily_seconds then
   return jsonb_build_object('code','DAILY_LIMIT','resetAt',day_start+interval '1 day'); end if;
 if p_kind='stt' and monthly_used+p_seconds>policy.monthly_seconds then
   return jsonb_build_object('code','MONTHLY_LIMIT','resetAt',month_start+interval '1 month'); end if;
 select coalesce(sum(cost_micro),0) into budget_used from sargosh_private.usage_operations where kind=p_kind and state<>'released' and reserved_at>=month_start;
 if budget_used+p_cost_micro > (case when p_kind='stt' then policy.stt_budget_micro else policy.cleanup_budget_micro end) then
   return jsonb_build_object('code','SERVICE_BUDGET','resetAt',month_start+interval '1 month'); end if;
 insert into sargosh_private.usage_operations(user_id,request_id,kind,fingerprint,seconds,cost_micro,state)
 values(p_user_id,p_request_id,p_kind,p_fingerprint,p_seconds,p_cost_micro,'reserved')
 on conflict(user_id,request_id,kind) do update set state='reserved',lease_id=gen_random_uuid(),reserved_at=now(),dispatched_at=null,finished_at=null,seconds=p_seconds,cost_micro=p_cost_micro;
 return (select jsonb_build_object('code','OK','leaseId',lease_id) from sargosh_private.usage_operations where user_id=p_user_id and request_id=p_request_id and kind=p_kind);
end $$;

create or replace function public.dispatch_usage(p_user_id uuid,p_request_id text,p_kind text,p_lease_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update sargosh_private.usage_operations set state='dispatched',dispatched_at=now()
 where user_id=p_user_id and request_id=p_request_id and kind=p_kind and lease_id=p_lease_id and state='reserved' and reserved_at>now()-interval '2 minutes';
 return found;
end $$;
create or replace function public.finish_usage(p_user_id uuid,p_request_id text,p_kind text,p_lease_id uuid,p_cost_micro bigint default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update sargosh_private.usage_operations set state='done',finished_at=now(),
 cost_micro=case when p_cost_micro is null then cost_micro else greatest(0,p_cost_micro) end
 where user_id=p_user_id and request_id=p_request_id and kind=p_kind and lease_id=p_lease_id and state='dispatched';
 return found;
end $$;
create or replace function public.release_usage(p_user_id uuid,p_request_id text,p_kind text,p_lease_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update sargosh_private.usage_operations set state='released',finished_at=now()
 where user_id=p_user_id and request_id=p_request_id and kind=p_kind and lease_id=p_lease_id and state='reserved';
 return found;
end $$;
create or replace function public.account_usage(p_user_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('enabled',exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null),
 'dailyLimitSeconds',p.daily_seconds,'monthlyLimitSeconds',p.monthly_seconds,
 'dailyUsedSeconds',coalesce((select sum(seconds) from sargosh_private.usage_operations where user_id=p_user_id and kind='stt' and state<>'released' and (state<>'reserved' or reserved_at>=now()-interval '2 minutes') and reserved_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
 'monthlyUsedSeconds',coalesce((select sum(seconds) from sargosh_private.usage_operations where user_id=p_user_id and kind='stt' and state<>'released' and (state<>'reserved' or reserved_at>=now()-interval '2 minutes') and reserved_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0),
 'dailyResetAt',(date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC',
 'monthlyResetAt',(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC')
 from sargosh_private.usage_policy p where singleton;
$$;
revoke all on function public.reserve_usage(uuid,text,text,text,integer,bigint) from public,anon,authenticated;
revoke all on function public.dispatch_usage(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.finish_usage(uuid,text,text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.release_usage(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.account_usage(uuid) from public,anon,authenticated;
grant execute on function public.reserve_usage(uuid,text,text,text,integer,bigint),public.dispatch_usage(uuid,text,text,uuid),public.finish_usage(uuid,text,text,uuid,bigint),public.release_usage(uuid,text,text,uuid),public.account_usage(uuid) to service_role;
commit;
