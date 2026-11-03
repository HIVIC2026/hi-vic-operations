-- Rollback of 2026-11-03_allocate_team_electrician_v2.sql: restores the 2026-11-01 body word for word (the profile +
-- membership test returns: 'Electrician needs active Team access'). Assignments and events written by v2 are left as they are.
CREATE OR REPLACE FUNCTION public.allocate_team_electrician(_job uuid,_actor uuid,_worker uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE business uuid; w public.partner_workers%ROWTYPE; previous public.job_assignments%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.jobs WHERE id=_job AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable'; END IF;
  SELECT a.business_id INTO business FROM public.job_assignments a JOIN public.businesses b ON b.id=a.business_id
    WHERE a.job_id=_job AND a.active AND a.role::text='installer' AND b.in_house AND b.is_active FOR SHARE OF a,b;
  IF business IS NULL OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE business_id=business AND user_id=_actor AND active) THEN
    RAISE EXCEPTION 'This job is not assigned to your business'; END IF;
  SELECT * INTO w FROM public.partner_workers WHERE id=_worker AND business_id=business AND trade_role='electrician' AND removed_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That electrician is not on your Team'; END IF;
  IF w.approval_status IS DISTINCT FROM 'approved' OR nullif(trim(w.licence_number),'') IS NULL OR nullif(trim(w.rec_number),'') IS NULL
    OR w.licence_expires_on IS NULL OR w.licence_expires_on < (now() AT TIME ZONE 'Australia/Melbourne')::date OR w.licence_verified_at IS NULL THEN RAISE EXCEPTION 'Electrician not verified'; END IF;
  IF w.profile_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE business_id=business AND user_id=w.profile_id AND active) THEN
    RAISE EXCEPTION 'Electrician needs active Team access'; END IF;
  SELECT * INTO previous FROM public.job_assignments WHERE job_id=_job AND role::text='electrician' AND active FOR UPDATE;
  IF FOUND AND previous.business_id IS DISTINCT FROM business THEN RAISE EXCEPTION 'This electrician assignment belongs to another business'; END IF;
  IF FOUND AND previous.user_id=w.profile_id THEN RETURN jsonb_build_object('already_allocated',true); END IF;
  UPDATE public.job_assignments SET active=false,ended_at=now(),end_reason='Team electrician changed' WHERE job_id=_job AND role::text='electrician' AND active;
  INSERT INTO public.job_assignments(job_id,user_id,business_id,role,active,assigned_by) VALUES (_job,w.profile_id,business,'electrician',true,_actor);
  UPDATE public.jobs SET electrician_choice='preferred' WHERE id=_job;
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES
    (_job,_actor,'in_house_electrician_allocated','Safety check allocated to ' || w.full_legal_name,jsonb_build_object('worker_id',_worker,'business_id',business,'previous_assignment_id',previous.id),true);
  RETURN jsonb_build_object('already_allocated',false);
END $$;
REVOKE ALL ON FUNCTION public.allocate_team_electrician(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_team_electrician(uuid,uuid,uuid) TO service_role;
