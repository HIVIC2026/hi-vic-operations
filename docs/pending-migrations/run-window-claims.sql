-- A48 batch 2 part 2, Task 7 fix round 1 (Jo 30 Oct 2026): no double-booking of an installer person's Ready Check window.
-- Fix round 2: windows are 1 hour but starts sit on the half-hour grid, so a window claims EVERY half-hour slot it covers
-- (08:00-09:00 -> 08:00 and 08:30), all or nothing. Before a window is proposed (installer's day pick, or an owner picking
-- another window) the server writes ONE `run_window_claimed` workflow event PER HALF-HOUR keyed
-- details->>'idempotency_key' = 'run-window:v2:<person>:<day>:<slot>:<gen>' (gen = the n-th claim of that half-hour);
-- freeing it (released / moved / not used / stale) writes ONE `run_window_freed` keyed
-- 'run-window-freed:v2:<person>:<day>:<slot>:<gen>', after which the next claim uses gen + 1. An 08:00 and an 08:30
-- window of the same person both need the 08:30 slot, so only one can win it.
-- No new table and no constraint changes (each event carries its job; the log stays append-only). Idempotent.
-- Until applied the server checks for an earlier claim first and the earliest row of a generation wins; this index makes
-- two claims of the same half-hour race-proof (the second insert fails with 23505 and that window is not proposed).
-- Proven on PGlite: tests/run-window-claims-practice-db.test.ts.
create unique index if not exists workflow_events_run_window_once_idx on public.workflow_events ((details->>'idempotency_key'))
  where event_type in ('run_window_claimed', 'run_window_freed');
