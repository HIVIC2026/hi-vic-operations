-- Decision 382 (Jo 25 Oct 2026: "still extremely slow and unusable"): Needs me is served from a saved copy that the
-- server refreshes in the background, instead of ~380 reads on every open. Server-only table (service role):
-- RLS on with no policies, so the browser can never read or write it. Re-runnable.
CREATE TABLE IF NOT EXISTS public.office_needs_snapshot (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL,
  refreshing_at timestamptz
);
ALTER TABLE public.office_needs_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.office_needs_snapshot FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON public.office_needs_snapshot FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON public.office_needs_snapshot FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT ALL ON public.office_needs_snapshot TO service_role'; END IF;
END $$;
