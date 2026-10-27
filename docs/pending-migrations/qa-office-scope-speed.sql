-- Performance only (Jo approved 27 Oct 2026). Same rows for every role; APPLIED on live 27 Oct 2026 ~23:40 Melbourne with Jo's OK (16/16 policies wrapped; admin jobs read 4 ms, workflow_events 18 ms).
-- Why: Postgres ORs a table's permissive SELECT policies with admin_all LAST, so for an admin the per-row helper
-- (can_access_job, is_job_owner, ...) runs once per row before the admin check is reached (jobs 300 ms, owners
-- 370 ms, properties 600 ms, workflow_events 5.6 s as admin on live 27 Oct). The RESTRICTIVE qa_office_scope
-- policies are already evaluated once per query and are NOT touched here.
-- Fix: inside each per-row policy below, check (SELECT is_admin()) first. Every listed table already has a
-- permissive admin policy for authenticated with exactly (SELECT is_admin()) (checked below, fails closed), so
-- "admin OR <original>" adds no rows for anyone. TEST-office users are never admin (is_qa_office() requires no
-- other role), so their rows and the qa_office_* policies are unchanged.
-- Re-runnable: already-wrapped policies are skipped; a policy that differs from what we expect stops the run.
DO $speed$
DECLARE
  p record;
  cur text;
  norm text;
  prefix constant text := '(( SELECT is_admin() AS is_admin) OR ';
BEGIN
  FOR p IN SELECT * FROM (VALUES
    ('jobs', 'job_access', $q$can_access_job(id)$q$),
    ('assessments', 'job_access', $q$can_access_job(job_id)$q$),
    ('bookings', 'job_access', $q$can_access_job(job_id)$q$),
    ('documents', 'job_access', $q$can_access_job(job_id)$q$),
    ('evidence_files', 'job_access', $q$can_access_job(job_id)$q$),
    ('evidence_requirements', 'job_access', $q$can_access_job(job_id)$q$),
    ('job_assignments', 'job_access', $q$can_access_job(job_id)$q$),
    ('ceiling_measurements', 'job participants read measurements', $q$can_access_job(job_id)$q$),
    ('workflow_events', 'job_access_non_internal', $q$(can_access_job(job_id) AND (NOT internal))$q$),
    ('properties', 'job_access', $q$(EXISTS ( SELECT 1 FROM jobs j WHERE ((j.property_id = properties.id) AND can_access_job(j.id))))$q$),
    ('owners', 'owner_or_assignee', $q$((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM jobs j WHERE ((j.owner_id = owners.id) AND has_contact_release(j.id, ( SELECT auth.uid() AS uid))))))$q$),
    ('invoices', 'owner_read', $q$is_job_owner(job_id, ( SELECT auth.uid() AS uid))$q$),
    ('job_communications', 'owner reads customer communications', $q$((visibility = 'customer'::text) AND is_job_owner(job_id, ( SELECT auth.uid() AS uid)))$q$),
    ('job_communications', 'trade reads trade communications', $q$((visibility = 'trade'::text) AND (job_assignment_role(job_id, ( SELECT auth.uid() AS uid)) IS NOT NULL))$q$),
    ('quotes', 'quote_visibility', $q$quote_visible_to_current_user(job_id, kind, status, release_state, sent_at)$q$),
    ('quote_items', 'quote_items_visibility', $q$(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_items.quote_id) AND quote_visible_to_current_user(q.job_id, q.kind, q.status, q.release_state, q.sent_at))))$q$)
  ) AS v(tbl, pol, original) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies a WHERE a.schemaname = 'public' AND a.tablename = p.tbl
        AND a.permissive = 'PERMISSIVE' AND a.cmd IN ('ALL', 'SELECT') AND 'authenticated' = ANY (a.roles)
        AND a.qual = '( SELECT is_admin() AS is_admin)') THEN
      RAISE EXCEPTION 'qa-office-scope-speed: % has no permissive admin read policy; not changed', p.tbl;
    END IF;
    SELECT qual INTO cur FROM pg_policies
      WHERE schemaname = 'public' AND tablename = p.tbl AND policyname = p.pol AND permissive = 'PERMISSIVE'
        AND cmd = 'SELECT' AND roles = '{authenticated}';
    IF cur IS NULL THEN
      RAISE EXCEPTION 'qa-office-scope-speed: policy "%" on % not found as expected', p.pol, p.tbl;
    END IF;
    norm := regexp_replace(cur, '\s+', ' ', 'g');
    IF norm = prefix || p.original || ')' THEN
      CONTINUE; -- already applied
    ELSIF norm <> p.original THEN
      RAISE EXCEPTION 'qa-office-scope-speed: policy "%" on % changed since 27 Oct (%); not changed', p.pol, p.tbl, norm;
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I USING ((SELECT public.is_admin()) OR (%s))', p.pol, p.tbl, p.original);
  END LOOP;
END
$speed$;
