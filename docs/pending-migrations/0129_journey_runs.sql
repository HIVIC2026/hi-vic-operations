-- Full-journey test results (browser or server runs). Admin read only; written by the server/runner.
CREATE TABLE IF NOT EXISTS public.journey_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('browser','server')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  passed boolean,
  failing_step text,
  failing_reason text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.journey_runs TO authenticated;
GRANT ALL ON public.journey_runs TO service_role;
ALTER TABLE public.journey_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read journey runs" ON public.journey_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS journey_runs_started_idx ON public.journey_runs (started_at DESC);
