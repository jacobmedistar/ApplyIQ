-- Run after creating the two named secrets in Supabase Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'applyiq-inquiry-acknowledgements',
  '* * * * *',
  $job$
  select net.http_post(
    url := url.decrypted_secret,
    headers := jsonb_build_object('Authorization','Bearer ' || secret.decrypted_secret,'Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  )
  from vault.decrypted_secrets url cross join vault.decrypted_secrets secret
  where url.name='applyiq_ack_worker_url' and secret.name='applyiq_ack_worker_secret';
  $job$
);
