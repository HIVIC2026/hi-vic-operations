-- Decision 389 (Jo, owner, 25 Oct 2026): Jo releases a saved spot to the installer she chooses; the OWNER gets "It's
-- your turn" and confirms (or says no) before any installer is contacted; one reminder at day 2, lapse at day 5.
-- Stored as append-only workflow_events (no new table): spot_released, spot_release_confirmed, spot_release_declined,
-- spot_release_reminded, spot_release_lapsed. Each is a CLAIM written before anything is sent or run, keyed
-- details->>'idempotency_key' = 'spot-release:v1:<job>:<release number>:<slot>' (slot released | reminder | release_text
-- | outcome). confirmed / declined / lapsed share the ONE "outcome" slot, so the owner's Confirm, their "no longer
-- interested" and the day-5 lapse can never both win, and two presses of Release can never both send.
-- No check constraint changes: every decision-389 event carries its job (workflow_events_job_required untouched) and
-- there is no event_type check on workflow_events. The log stays append-only (existing trigger untouched). Idempotent;
-- safe before or after the email migrations.
-- Until applied the server still checks for an earlier claim before inserting (read-then-insert, as decision 337);
-- this index makes the claim race-proof (the second insert fails with 23505 and nothing is sent or run).
-- Proven on PGlite: tests/spot-release-events-practice-db.test.ts.
create unique index if not exists workflow_events_spot_release_once_idx on public.workflow_events ((details->>'idempotency_key'))
  where event_type in ('spot_released', 'spot_release_confirmed', 'spot_release_declined', 'spot_release_reminded', 'spot_release_lapsed');
create index if not exists workflow_events_spot_release_idx on public.workflow_events (job_id, event_type)
  where event_type in ('spot_released', 'spot_release_confirmed', 'spot_release_declined', 'spot_release_reminded', 'spot_release_lapsed');
