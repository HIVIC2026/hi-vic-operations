-- A48 batch 1 final fix (29 Oct 2026): the "safety check breaks the official rules" electrician message goes once per PIESA
-- form version. recheckPiesaRules (piesa-rules-notice.server.ts) writes the FIRST `piesa_rules_failed` event for a form
-- version with details->>'notice_key' = piesa-rules:v1:<jobId>:<formVersion> BEFORE it sends anything. Two Mitti syncs of
-- the same form at the same time could both read "not told yet" and both send; with this index the second insert fails
-- with 23505, the server reads that as "already recorded" and sends nothing.
-- Later failure events for an already-told form version carry no notice_key (NULL is never a conflict), so history and the
-- existing rows are untouched. No table, column, check or trigger change; the log stays append-only. Idempotent.
-- Until applied: the text already has its own once-only key (sms.server) and the email carries the same key as the email
-- service's Idempotency-Key, so a concurrent repeat is dropped there; only the duplicate event row remains possible.
-- Proven on PGlite: tests/a48-b1-piesa-rules-once-practice-db.test.ts. Undo: piesa-rules-once.undo.sql.
create unique index if not exists workflow_events_piesa_rules_once_idx on public.workflow_events ((details->>'notice_key'))
  where event_type = 'piesa_rules_failed' and details ? 'notice_key';
