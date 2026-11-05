-- Completes a VEEC assignment in one transaction: assignment row + owner_authority compliance check + audit event, or none of them.
-- Returns false (and writes nothing) when the assignment is already effective_complete. Service-role only.
-- Pending: prove on PGlite, apply live only when Jo says yes. The portal keeps its old three-write path until this is deployed.
CREATE FUNCTION public.complete_veec_assignment(
  p_assignment_id uuid, p_job_id uuid, p_path text, p_effective_at timestamptz,
  p_delivery text, p_sha256 text, p_actor uuid, p_summary text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.customer_assignments
     SET status = 'effective_complete', effective_at = p_effective_at, completed_at = p_effective_at,
         final_copy_path = p_path, final_copy_at = CASE WHEN p_path IS NOT NULL THEN p_effective_at END,
         delivery_status = p_delivery
   WHERE id = p_assignment_id AND job_id = p_job_id AND status <> 'effective_complete';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN false; END IF;

  UPDATE public.compliance_checks
     SET status = 'pass', checked_at = p_effective_at, notes = 'Final VEEC assignment effective'
   WHERE job_id = p_job_id AND check_key = 'owner_authority';

  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details)
  VALUES (p_job_id, p_actor, 'VEEC_ASSIGNMENT_EFFECTIVE', p_summary,
          jsonb_build_object('assignment_id', p_assignment_id, 'sha256', p_sha256));
  UPDATE public.jobs SET last_activity_at = now() WHERE id = p_job_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.complete_veec_assignment(uuid, uuid, text, timestamptz, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_veec_assignment(uuid, uuid, text, timestamptz, text, text, uuid, text) TO service_role;
