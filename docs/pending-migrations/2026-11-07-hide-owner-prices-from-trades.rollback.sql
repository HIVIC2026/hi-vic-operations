-- Rollback for 2026-11-07-hide-owner-prices-from-trades.sql (launch blocker Task 8). PROPOSAL ONLY, NOT APPLIED.
-- Puts back internal = false on exactly the rows that fix changed (ids saved in public._bk_20261107_hidden_owner_prices),
-- then drops that record. Rows that were already internal before the fix are not touched. workflow_events is append-only
-- (trigger workflow_events_immutable), so the trigger is off for this one UPDATE only, inside one transaction (same as
-- the fix and drizzle 0195). No record table = nothing to undo (re-running is a no-op).
-- PREVIEW: SELECT count(*)::int AS n FROM public._bk_20261107_hidden_owner_prices;
-- Proven on PGlite by tests/trade-history-no-prices.test.ts.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public._bk_20261107_hidden_owner_prices') IS NOT NULL THEN
    ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable;
    UPDATE public.workflow_events SET internal = false
    WHERE internal = true AND id IN (SELECT id FROM public._bk_20261107_hidden_owner_prices);
    ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;
    DROP TABLE public._bk_20261107_hidden_owner_prices;
  END IF;
END
$$;
COMMIT;
