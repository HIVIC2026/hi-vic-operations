ALTER TABLE public.partner_workers
  ADD COLUMN rec_number text,
  ADD COLUMN licence_verified_at timestamptz,
  ADD COLUMN licence_verified_by uuid;

-- Only the office RPC may stamp verification; declared edits invalidate the stamp.
CREATE FUNCTION public.guard_team_electrician_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF (TG_OP='INSERT' AND (NEW.licence_verified_at IS NOT NULL OR NEW.licence_verified_by IS NOT NULL))
    OR (TG_OP='UPDATE' AND ROW(NEW.licence_verified_at,NEW.licence_verified_by) IS DISTINCT FROM ROW(OLD.licence_verified_at,OLD.licence_verified_by)) THEN
    IF current_setting('hivic.electrician_verification',true) IS DISTINCT FROM 'office_rpc' THEN RAISE EXCEPTION 'Office only'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.licence_number,NEW.rec_number,NEW.licence_expires_on,NEW.trade_role,NEW.removed_at)
    IS DISTINCT FROM ROW(OLD.licence_number,OLD.rec_number,OLD.licence_expires_on,OLD.trade_role,OLD.removed_at)
    AND current_setting('hivic.electrician_verification',true) IS DISTINCT FROM 'office_rpc' THEN
    NEW.licence_verified_at=NULL; NEW.licence_verified_by=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER team_electrician_verification BEFORE INSERT OR UPDATE ON public.partner_workers
  FOR EACH ROW EXECUTE FUNCTION public.guard_team_electrician_verification();

CREATE FUNCTION public.verify_team_electrician(_worker uuid,_licence text,_rec text,_expiry date,_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w public.partner_workers%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN RAISE EXCEPTION 'Office only'; END IF;
  SELECT * INTO w FROM public.partner_workers WHERE id=_worker AND trade_role='electrician' AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Electrician not found'; END IF;
  IF nullif(trim(_licence),'') IS NULL OR nullif(trim(_rec),'') IS NULL OR _expiry IS NULL OR _expiry < (now() AT TIME ZONE 'Australia/Melbourne')::date THEN
    RAISE EXCEPTION 'Enter the licence number, REC number and current expiry'; END IF;
  PERFORM set_config('hivic.electrician_verification','office_rpc',true);
  UPDATE public.partner_workers SET licence_number=trim(_licence),rec_number=trim(_rec),licence_expires_on=_expiry,licence_verified_at=now(),licence_verified_by=_actor WHERE id=_worker;
  PERFORM set_config('hivic.electrician_verification','',true);
  INSERT INTO public.admin_config_events(actor_id,event_type,summary,details) VALUES
    (_actor,'electrician_licence_verified','Electrician licence + REC verified',jsonb_build_object('worker_id',_worker,'business_id',w.business_id,'licence_number',trim(_licence),'rec_number',trim(_rec),'licence_expires_on',_expiry));
END $$;
REVOKE ALL ON FUNCTION public.verify_team_electrician(uuid,text,text,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_team_electrician(uuid,text,text,date,uuid) TO service_role;

CREATE FUNCTION public.allocate_team_electrician(_job uuid,_actor uuid,_worker uuid)
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

-- Batch handoff no longer chooses an electrician.
-- Retain all prior consent, coverage, actor, installer and pending-notice guards.
DO $$
DECLARE body text;
BEGIN
  SELECT pg_get_functiondef('public.allocate_in_house_batch_job(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO body;
  IF position('Owner has not said yes in quick taps' IN body)=0 THEN RAISE EXCEPTION 'Apply Task 1 quick taps migration first'; END IF;
  body := replace(body,
    '  PERFORM 1 FROM public.partner_workers w JOIN public.business_members m ON m.business_id=w.business_id AND m.user_id=w.profile_id' || chr(10) || '    WHERE w.business_id=_business AND w.profile_id=_electrician',
    '  IF _electrician IS NOT NULL THEN' || chr(10) || '  PERFORM 1 FROM public.partner_workers w JOIN public.business_members m ON m.business_id=w.business_id AND m.user_id=w.profile_id' || chr(10) || '    WHERE w.business_id=_business AND w.profile_id=_electrician');
  body := replace(body,
    '  INSERT INTO public.in_house_batches(id,business_id,job_ids,sent_by)',
    '  END IF;' || chr(10) || '  INSERT INTO public.in_house_batches(id,business_id,job_ids,sent_by)');
  body := replace(body,
    '    (_job,_installer,''installer'',_business,true,_actor),(_job,_electrician,''electrician'',_business,true,_actor);',
    '    (_job,_installer,''installer'',_business,true,_actor);' || chr(10) || '  IF _electrician IS NOT NULL THEN' || chr(10) || '    INSERT INTO public.job_assignments(job_id,user_id,role,business_id,active,assigned_by) VALUES (_job,_electrician,''electrician'',_business,true,_actor);' || chr(10) || '  END IF;');
  body := replace(body,
    '  UPDATE public.jobs SET electrician_choice=''preferred'' WHERE id=_job AND deleted_at IS NULL AND source<>''qa_test'';',
    '  IF _electrician IS NOT NULL THEN UPDATE public.jobs SET electrician_choice=''preferred'' WHERE id=_job AND deleted_at IS NULL AND source<>''qa_test''; END IF;');
  IF position('IF _electrician IS NOT NULL THEN' IN body)=0 THEN RAISE EXCEPTION 'Unexpected batch function body'; END IF;
  EXECUTE body;
END $$;
