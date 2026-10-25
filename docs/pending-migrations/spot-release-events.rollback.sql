-- Rollback for spot-release-events.sql (decision 389): drops the once-only claim index and the lookup index. Events
-- already written stay (workflow_events is append-only); without the unique index the server falls back to its
-- read-then-insert check before each claim.
drop index if exists public.workflow_events_spot_release_idx;
drop index if exists public.workflow_events_spot_release_once_idx;
