-- Jo 26 Oct 2026: the AI email replies auto-send switch. OFF by default — simple AI replies stay drafts on the job
-- until Jo has approved samples and turns this on herself in Settings › Switches. Only "simple" replies (status,
-- thanks, resend a link/form, booking questions) ever go automatically; everything else stays a draft for Jo.
-- The code reads the column fail-closed: while it is missing the switch shows "waiting for the database change" and
-- nothing sends by itself. Idempotent and never resets a value Jo set. Proven on PGlite
-- (tests/ai-email-auto-send-switch-practice-db.test.ts) before any live run.
alter table public.workflow_settings
  add column if not exists ai_email_auto_send_enabled boolean not null default false;
