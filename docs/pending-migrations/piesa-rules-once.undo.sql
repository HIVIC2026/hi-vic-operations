-- Undo for piesa-rules-once.sql: drops only the once-per-form-version unique index. Event rows already written stay
-- (workflow_events is append-only); the email / text once-only keys still stop a repeated send.
drop index if exists public.workflow_events_piesa_rules_once_idx;
