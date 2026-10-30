-- A48 batch 2 part 2, Task 7 fix round 1 (Jo 30 Oct 2026): no double-booking of an installer person's Ready Check window.
-- Before a run window is proposed (installer's day pick, or an owner picking another window) the server writes ONE
-- `run_window_claimed` workflow event keyed details->>'idempotency_key' = 'run-window:v1:<person>:<day>:<start>:<gen>'
-- (gen = the n-th claim of that window); freeing it (released / moved / not used / stale) writes ONE `run_window_freed`
-- keyed 'run-window-freed:v1:<person>:<day>:<start>:<gen>', after which the next claim uses gen + 1.
-- No new table and no constraint changes (each event carries its job; the log stays append-only). Idempotent.
-- Until applied the server checks for an earlier claim first and the earliest row of a generation wins; this index makes
-- two claims of the same window race-proof (the second insert fails with 23505 and that window is not proposed).
-- Proven on PGlite: tests/run-window-claims-practice-db.test.ts.
create unique index if not exists workflow_events_run_window_once_idx on public.workflow_events ((details->>'idempotency_key'))
  where event_type in ('run_window_claimed', 'run_window_freed');
