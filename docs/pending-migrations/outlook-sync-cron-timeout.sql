-- Outlook sync cron: wait up to 55 s for the reply (pg_net's default is 5 s).
-- Why: job 5 (`hivic-outlook-sync`) has no timeout_milliseconds, so pg_net gives up after 5 s and records a timeout
-- even when the run finishes later (19 of 24 Outlook-only ticks, 05:40-11:40 UTC 27 Oct). The run itself is now
-- bounded at ~35 s (runOutlookSync budget), so 55 s matches the allocation tick and is always enough.
-- Only the timeout is added; the URL and its Authorization header are kept exactly as they are. Idempotent.
SELECT cron.alter_job(j.jobid, command := replace(j.command, 'body := ''{}''::jsonb)', 'body := ''{}''::jsonb, timeout_milliseconds := 55000)'))
FROM cron.job j
WHERE j.jobname = 'hivic-outlook-sync'
  AND j.command LIKE '%hooks/outlook-sync%'
  AND j.command NOT LIKE '%timeout_milliseconds%'
  AND j.command LIKE '%body := ''{}''::jsonb)%';
