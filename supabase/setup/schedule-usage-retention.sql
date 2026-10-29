-- Run if pg_cron was not enabled when the account-recreation migration was applied.
-- Run as the database owner in SQL Editor; never as a desktop/public client.
select cron.schedule('sargosh-purge-deleted-allowance','0 * * * *',
 'select sargosh_private.purge_deleted_allowance()');
