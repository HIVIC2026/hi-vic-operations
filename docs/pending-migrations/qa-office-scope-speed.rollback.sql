-- Rollback for qa-office-scope-speed.sql: put each policy back to its exact 27 Oct 2026 rule.
-- Re-runnable: policies already at the original are skipped; anything else unexpected stops the run.
DO $undo$
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
    SELECT qual INTO cur FROM pg_policies WHERE schemaname = 'public' AND tablename = p.tbl AND policyname = p.pol;
    IF cur IS NULL THEN
      RAISE EXCEPTION 'qa-office-scope-speed rollback: policy "%" on % not found', p.pol, p.tbl;
    END IF;
    norm := regexp_replace(cur, '\s+', ' ', 'g');
    IF norm = p.original THEN
      CONTINUE; -- already original
    ELSIF norm <> prefix || p.original || ')' THEN
      RAISE EXCEPTION 'qa-office-scope-speed rollback: policy "%" on % is not the sped-up form (%); not changed', p.pol, p.tbl, norm;
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.pol, p.tbl, p.original);
  END LOOP;
END
$undo$;
