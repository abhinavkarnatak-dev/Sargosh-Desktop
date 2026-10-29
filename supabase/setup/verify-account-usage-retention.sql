-- Read-only deployment check; returns no keys, email identifiers or user data.
select
 exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='sargosh_retain_deleted_allowance' and tgenabled='O') as deletion_trigger_enabled,
 (select count(*)=1 from sargosh_private.usage_identity_secret) as protection_key_configured,
 (select relrowsecurity from pg_class where oid='sargosh_private.deleted_account_allowance'::regclass) as protection_rls_enabled,
 exists(select 1 from cron.job where jobname='sargosh-purge-deleted-allowance' and active) as expiry_job_active;
