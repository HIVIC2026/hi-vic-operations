-- Performance only (Jo 26 Oct 2026). Same rows for every role; nothing else changes.
-- 1. RLS: evaluate the per-user helpers ONCE per query instead of once per row by wrapping them in a sub-select
--    (Postgres "initPlan"). is_admin(), has_role(<me>, '<role>') and auth.uid() only depend on the signed-in user, so
--    the result is identical. Policy names, commands, roles and logic are untouched. Re-runnable (skips wrapped calls).
DO $rls$
DECLARE
  r record;
  q text;
  c text;
  stmt text;
BEGIN
  FOR r IN SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    q := r.qual;
    c := r.with_check;
    IF q IS NOT NULL THEN
      q := regexp_replace(q, '(?<!SELECT )\mauth\.uid\(\)', '(SELECT auth.uid())', 'g');
      q := regexp_replace(q, '(?<!SELECT )\mhas_role\(\(SELECT auth\.uid\(\)\), (''[a-z_]+''::app_role)\)', '(SELECT has_role((SELECT auth.uid()), \1))', 'g');
      q := regexp_replace(q, '(?<!SELECT )(?<![a-z_.])is_admin\(\)', '(SELECT is_admin())', 'g');
    END IF;
    IF c IS NOT NULL THEN
      c := regexp_replace(c, '(?<!SELECT )\mauth\.uid\(\)', '(SELECT auth.uid())', 'g');
      c := regexp_replace(c, '(?<!SELECT )\mhas_role\(\(SELECT auth\.uid\(\)\), (''[a-z_]+''::app_role)\)', '(SELECT has_role((SELECT auth.uid()), \1))', 'g');
      c := regexp_replace(c, '(?<!SELECT )(?<![a-z_.])is_admin\(\)', '(SELECT is_admin())', 'g');
    END IF;
    IF q IS DISTINCT FROM r.qual OR c IS DISTINCT FROM r.with_check THEN
      stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
      IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
      IF c IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', c); END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END
$rls$;

-- 2. Indexes for lookups that currently scan whole tables (seen in the live database statistics).
CREATE INDEX IF NOT EXISTS appointment_proposals_job_kind_created_idx ON public.appointment_proposals (job_id, kind, created_at);
CREATE INDEX IF NOT EXISTS contact_releases_job_idx ON public.contact_releases (job_id);
CREATE INDEX IF NOT EXISTS jobs_property_id_idx ON public.jobs (property_id);
CREATE INDEX IF NOT EXISTS jobs_last_activity_idx ON public.jobs (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS rectification_items_job_idx ON public.rectification_items (job_id);
