-- 5 Nov 2026 10:42 Melbourne, APPLIED LIVE (Jo approved): the hivic-mitti-pull pg_cron job called the Mitti pull hook with
-- pg_net's DEFAULT 5-second timeout. When the server is slow (every server call 4–13 s on go-live day) pg_net hangs up at
-- 5 s, the POST is aborted mid-job, the run never checkpoints, and the next tick restarts on the SAME job — the Mitti sync
-- stood still from 09:31 to 10:45. hivic-allocation-tick already passed 55 s. This gives the pull 120 s.
-- Undo: the same alter_job without timeout_milliseconds (back to 5 s) — don't.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'hivic-mitti-pull'),
  command := $c$/* lovable:authenticated-cron:v1 */ SELECT net.http_post(url := 'https://project--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app/api/public/hooks/mitti-pull', headers := '{"Authorization":"Bearer <lovable cron secret>","Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 120000);$c$
);
