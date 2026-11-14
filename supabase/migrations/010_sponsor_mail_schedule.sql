-- Check Gmail for sponsor replies every 10 minutes by calling the sponsor-mail
-- Edge Function. Supabase-only (pg_cron, pg_net, Vault); not part of the local
-- PGlite tests. Safe to run more than once.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 25MB per pitch file; Gmail won't deliver much more than that anyway.
update storage.buckets set file_size_limit = 26214400 where id = 'sponsor-files';

-- A random secret the job sends, so only this job (or a signed-in admin) can
-- trigger a check.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sponsor_mail_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'sponsor_mail_cron_secret',
      'Shared secret between the sponsor-mail-check cron job and the sponsor-mail function');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'sponsor-mail-check';
select cron.schedule('sponsor-mail-check', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://fskgdjktsqowsfxswkwe.supabase.co/functions/v1/sponsor-mail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sponsor_mail_cron_secret')),
    body := '{"action":"check"}'::jsonb,
    timeout_milliseconds := 55000)
$job$);
