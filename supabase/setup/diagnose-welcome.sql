-- Read-only diagnostics. Returns counts and status labels, never credentials or recipient data.
select jsonb_build_object(
 'queue',coalesce((select jsonb_agg(x) from (
   select status,attempts,last_error,count(*) as emails
   from public.welcome_emails group by status,attempts,last_error
 ) x),'[]'::jsonb),
 'signup', (select jsonb_build_object(
   'enabled_at',c.enabled_at,
   'new_accounts',(select count(*) from auth.users u where u.created_at>=c.enabled_at),
   'new_verified_accounts',(select count(*) from auth.users u where u.created_at>=c.enabled_at and u.email_confirmed_at is not null),
   'new_ready_accounts',(select count(*) from auth.users u where u.created_at>=c.enabled_at and u.email_confirmed_at is not null and nullif(btrim(coalesce(u.raw_user_meta_data->>'first_name',split_part(btrim(u.raw_user_meta_data->>'full_name'),' ',1),'')),'') is not null)
 ) from sargosh_private.welcome_config c where singleton),
 'vault',(select jsonb_build_object(
   'worker_token_count',count(*) filter(where name='welcome_worker_token'),
   'worker_url_count',count(*) filter(where name='welcome_worker_url'),
   'url_has_correct_path',coalesce(bool_or(decrypted_secret ~ '^https://[^/]+/functions/v1/send-welcome/?$') filter(where name='welcome_worker_url'),false)
 ) from vault.decrypted_secrets where name in ('welcome_worker_token','welcome_worker_url')),
 'cron',coalesce((select jsonb_agg(x) from (
   select j.jobname,j.active,(select d.status from cron.job_run_details d where d.jobid=j.jobid order by d.start_time desc limit 1) as latest_status
   from cron.job j where j.jobname='sargosh-welcome-email'
 ) x),'[]'::jsonb),
 'http',coalesce((select jsonb_agg(x) from (
   select status_code,timed_out,created,
     substring(content from '"error"[[:space:]]*:[[:space:]]*"([a-zA-Z0-9_ -]{1,80})"') as response_error
   from net._http_response order by created desc limit 5
 ) x),'[]'::jsonb)
) as welcome_diagnostics;
