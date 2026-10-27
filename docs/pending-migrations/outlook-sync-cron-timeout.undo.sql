-- Undo outlook-sync-cron-timeout.sql: back to pg_net's default 5 s timeout.
SELECT cron.alter_job(j.jobid, command := replace(j.command, ', timeout_milliseconds := 55000)', ')'))
FROM cron.job j
WHERE j.jobname = 'hivic-outlook-sync' AND j.command LIKE '%timeout_milliseconds := 55000)%';
