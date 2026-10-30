-- Rollback for run-window-claims.sql: drops the once-only window claim index. Claims already written stay (workflow_events
-- is append-only); without the index the server falls back to its check-first claim (earliest row wins).
drop index if exists public.workflow_events_run_window_once_idx;
