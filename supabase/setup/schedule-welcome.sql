-- Prerequisites: enable pg_cron and pg_net in Database > Extensions.
-- In Supabase Vault, create welcome_worker_token with the legacy service_role JWT
-- from Project Settings > API Keys. This is an existing server credential, not a new API key.
-- Never use the publishable/anon key here. Do not paste credentials into this SQL file.
-- Also create welcome_worker_url with the deployed send-welcome function's HTTPS URL.
-- Run only after the migration and function deployment succeed.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='welcome_worker_token')
     or not exists(select 1 from vault.decrypted_secrets where name='welcome_worker_url') then
    raise exception 'Add the welcome worker URL and token to Vault first';
  end if;
end $$;
select cron.schedule('sargosh-welcome-email','* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='welcome_worker_url' limit 1),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='welcome_worker_token' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$job$);
