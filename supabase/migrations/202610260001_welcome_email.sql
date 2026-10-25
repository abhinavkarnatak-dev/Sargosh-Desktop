-- Run once in the Supabase SQL Editor before enabling the scheduled worker.
begin;
create schema if not exists sargosh_private;
revoke all on schema sargosh_private from public, anon, authenticated;
create table if not exists sargosh_private.welcome_config (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null default now()
);
alter table sargosh_private.welcome_config enable row level security;
revoke all on sargosh_private.welcome_config from public, anon, authenticated, service_role;
insert into sargosh_private.welcome_config(singleton) values(true) on conflict do nothing;
create table if not exists public.welcome_emails (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','review')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  provider_email_id text,
  last_error text
);
alter table public.welcome_emails enable row level security;
revoke all on public.welcome_emails from public, anon, authenticated;
-- Only the server RPCs below modify delivery records.
revoke all on public.welcome_emails from service_role;

create or replace function sargosh_private.queue_welcome_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare first_name text;
begin
  if new.created_at < (select enabled_at from sargosh_private.welcome_config where singleton)
     or new.email_confirmed_at is null or nullif(btrim(new.email),'') is null then return new; end if;
  -- Match the desktop profile rule: an explicit first_name takes precedence over full_name.
  first_name := left(btrim(coalesce(new.raw_user_meta_data->>'first_name',
    split_part(btrim(new.raw_user_meta_data->>'full_name'),' ',1),'')),80);
  if first_name = '' then return new; end if;
  insert into public.welcome_emails(user_id,email,first_name)
  values(new.id,new.email,first_name) on conflict(user_id) do nothing;
  return new;
end $$;
revoke all on function sargosh_private.queue_welcome_email() from public, anon, authenticated;
create or replace trigger sargosh_queue_welcome after insert or update of email_confirmed_at, raw_user_meta_data on auth.users
for each row execute function sargosh_private.queue_welcome_email();

create or replace function public.claim_welcome_emails()
returns setof public.welcome_emails language plpgsql security definer set search_path = '' as $$
begin
  -- An uncertain send is never automatically retried outside Resend's deduplication window.
  update public.welcome_emails set status='review',lease_id=null,lease_until=null,last_error='retry_window_expired'
  where status in ('pending','processing') and first_attempt_at < now()-interval '20 hours';
  update public.welcome_emails w set status='failed',lease_id=null,lease_until=null,last_error='account_changed'
  where w.status in ('pending','processing') and not exists(
    select 1 from auth.users u where u.id=w.user_id and u.email=w.email and u.email_confirmed_at is not null
  );
  update public.welcome_emails set status='review',lease_id=null,lease_until=null,last_error='attempts_exhausted'
  where attempts>=5 and (status='pending' or (status='processing' and lease_until<now()));
  return query
  with ready as (
    select user_id from public.welcome_emails
    where attempts<5 and ((status='pending' and next_attempt_at<=now()) or (status='processing' and lease_until<now()))
    order by created_at for update skip locked limit 5
  )
  update public.welcome_emails w set status='processing',attempts=w.attempts+1,
    first_attempt_at=coalesce(w.first_attempt_at,now()),lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
  from ready where w.user_id=ready.user_id returning w.*;
end $$;

create or replace function public.finish_welcome_email(p_user_id uuid,p_lease_id uuid,p_provider_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.welcome_emails set status='sent',sent_at=now(),provider_email_id=left(p_provider_id,200),
    lease_id=null,lease_until=null,last_error=null
  where user_id=p_user_id and lease_id=p_lease_id and status='processing';
  return found;
end $$;

create or replace function public.fail_welcome_email(p_user_id uuid,p_lease_id uuid,p_error text,p_retry boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.welcome_emails set
    status=case when p_retry and attempts<5 then 'pending' when p_retry then 'review' else 'failed' end,
    next_attempt_at=now()+make_interval(mins => case attempts when 1 then 1 when 2 then 5 when 3 then 15 else 60 end),
    last_error=left(p_error,100),lease_id=null,lease_until=null
  where user_id=p_user_id and lease_id=p_lease_id and status='processing';
  return found;
end $$;
revoke all on function public.claim_welcome_emails() from public, anon, authenticated;
revoke all on function public.finish_welcome_email(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.fail_welcome_email(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_welcome_emails() to service_role;
grant execute on function public.finish_welcome_email(uuid,uuid,text) to service_role;
grant execute on function public.fail_welcome_email(uuid,uuid,text,boolean) to service_role;
commit;
