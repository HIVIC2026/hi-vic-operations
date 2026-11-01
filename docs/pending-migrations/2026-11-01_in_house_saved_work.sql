-- Pending only. Application canonical gates must succeed before this service-only
-- check-and-set. Booking, allocation, crew/ESC audit and retry intent commit together.
CREATE OR REPLACE FUNCTION public.in_house_visit_revision(_job uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH business AS (SELECT business_id FROM public.job_assignments WHERE job_id=_job AND role::text='installer' AND active),
 workers AS (SELECT w.* FROM public.partner_workers w WHERE w.business_id IN (SELECT business_id FROM business)),
 certs AS (SELECT c.* FROM public.partner_worker_certifications c WHERE c.worker_id IN (SELECT id FROM workers))
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.job_assignments a WHERE a.job_id=_job),
  (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.businesses b WHERE b.id IN (SELECT business_id FROM business)),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.user_id) FROM public.business_members m WHERE m.business_id IN (SELECT business_id FROM business)),
  (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM workers w),
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM certs c),
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.recorded_at) FROM public.worker_certification_levels l WHERE l.certification_id IN (SELECT id FROM certs)),
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.admin_config_events e WHERE e.details->>'business_id' IN (SELECT business_id::text FROM business)),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.application_id) FROM public.partner_activations a WHERE a.business_id IN (SELECT business_id FROM business)),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.rec_onboarding_applications a WHERE a.id IN (SELECT application_id FROM public.partner_activations WHERE business_id IN (SELECT business_id FROM business)))
 )::text);
$$;
REVOKE ALL ON FUNCTION public.in_house_visit_revision(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.in_house_visit_revision(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.commit_in_house_visit(
 _job uuid,_actor uuid,_kind text,_start timestamptz,_worker uuid,
 _stage text,_version timestamptz,_booking uuid,_crew uuid,
 _selection jsonb,_crew_facts jsonb,_work uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.jobs%ROWTYPE; w public.partner_workers%ROWTYPE;
 a public.job_assignments%ROWTYPE; b public.bookings%ROWTYPE;
 business uuid; current_crew uuid; old_worker uuid; target text; visit text;
 selected jsonb; work_details jsonb; new_booking uuid; old_start timestamptz;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=_job AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable'; END IF;
 SELECT x.* INTO a FROM public.job_assignments x JOIN public.businesses y ON y.id=x.business_id
 WHERE x.job_id=_job AND x.role::text='installer' AND x.active AND y.in_house AND y.is_active FOR SHARE OF x,y;
 business:=a.business_id;
 IF business IS NULL OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE business_id=business AND user_id=_actor AND active AND member_role::text IN ('business_admin','owner')) THEN
  RAISE EXCEPTION 'Not your in-house job'; END IF;
 SELECT * INTO w FROM public.partner_workers WHERE id=_worker AND business_id=business AND removed_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not your Team member'; END IF;
 SELECT id,(details->'selection'->>'lead')::uuid INTO current_crew,old_worker FROM public.workflow_events
 WHERE job_id=_job AND event_type='piisa_crew_selected' ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO b FROM public.bookings WHERE job_id=_job AND kind::text=CASE WHEN _kind='crew' THEN 'installation' ELSE _kind END AND status::text='confirmed' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 -- An exact successful replay is a no-op even when another office user clicked.
 IF EXISTS(SELECT 1 FROM public.workflow_events WHERE id=_work AND job_id=_job AND event_type='in_house_saved_work'
  AND details->>'workerId'=_worker::text AND details->>'kind'=_kind
  AND (_kind='crew' OR (details->>'start')::timestamptz=_start)
  AND coalesce(details->'selection','null'::jsonb)=coalesce(_selection,'null'::jsonb)) THEN
  RETURN jsonb_build_object('bookingId',b.id,'already',true,'workId',_work); END IF;
 IF _kind<>'crew' AND b.id IS NOT NULL AND b.scheduled_start=_start AND
  EXISTS(SELECT 1 FROM public.workflow_events WHERE job_id=_job AND event_type='in_house_saved_work' AND details->>'bookingId'=b.id::text AND details->>'workerId'=_worker::text AND coalesce(details->'selection','null'::jsonb)=coalesce(_selection,'null'::jsonb)) THEN
  RETURN (SELECT jsonb_build_object('bookingId',b.id,'already',true,'workId',id) FROM public.workflow_events
   WHERE job_id=_job AND event_type='in_house_saved_work' AND details->>'bookingId'=b.id::text AND details->>'workerId'=_worker::text ORDER BY created_at DESC LIMIT 1); END IF;
 IF j.stage::text IS DISTINCT FROM _stage OR j.updated_at IS DISTINCT FROM _version OR b.id IS DISTINCT FROM _booking OR current_crew IS DISTINCT FROM _crew THEN
  RAISE EXCEPTION 'Job changed concurrently; reload and re-evaluate blockers'; END IF;
 PERFORM 1 FROM public.business_members WHERE business_id=business FOR SHARE;
 PERFORM 1 FROM public.partner_workers WHERE business_id=business FOR SHARE;
 PERFORM 1 FROM public.partner_worker_certifications WHERE worker_id IN (SELECT id FROM public.partner_workers WHERE business_id=business) FOR SHARE;
 PERFORM 1 FROM public.worker_certification_levels WHERE certification_id IN (SELECT id FROM public.partner_worker_certifications WHERE worker_id IN (SELECT id FROM public.partner_workers WHERE business_id=business)) FOR SHARE;
 IF _crew_facts->>'revision' IS DISTINCT FROM public.in_house_visit_revision(_job) THEN RAISE EXCEPTION 'Team changed concurrently; reload and re-evaluate blockers'; END IF;
 IF _kind IN ('installation','crew') THEN
  IF w.trade_role::text<>'installer' OR NOT coalesce(w.esc_registered,false) OR w.esc_registered_at IS NULL THEN
   RAISE EXCEPTION 'The office must record this Lead Installer as an ESC-registered scheme participant before booking'; END IF;
  -- CII, White Card, declarations and full crew clearance were validated by the
  -- canonical office-audited Team reader before acquiring this check-and-set.
  selected:=_selection;
  IF selected IS NULL OR selected->>'lead' IS DISTINCT FROM _worker::text THEN RAISE EXCEPTION 'Choose the Lead Installer'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(selected->'additional','[]')) m WHERE NOT EXISTS(
   SELECT 1 FROM public.partner_workers p WHERE p.id=(m->>'workerId')::uuid AND p.business_id=business AND p.removed_at IS NULL)) THEN RAISE EXCEPTION 'Not your Team member'; END IF;
 ELSIF _kind IN ('assessment','rectification') THEN
  IF w.trade_role::text<>'electrician' OR w.approval_status::text IS DISTINCT FROM 'approved' OR w.profile_id IS NULL
   OR nullif(trim(w.licence_number),'') IS NULL OR nullif(trim(w.rec_number),'') IS NULL OR w.licence_verified_at IS NULL
   OR w.licence_expires_on IS NULL OR w.licence_expires_on<(now() AT TIME ZONE 'Australia/Melbourne')::date THEN RAISE EXCEPTION 'Electrician not verified'; END IF;
  PERFORM public.allocate_team_electrician(_job,_actor,_worker);
  SELECT * INTO a FROM public.job_assignments WHERE job_id=_job AND role::text='electrician' AND active FOR UPDATE;
 ELSIF _kind<>'ready_check' THEN RAISE EXCEPTION 'Unknown booking kind'; END IF;
 old_start:=b.scheduled_start;
 IF _kind<>'crew' THEN
  target:=CASE _kind WHEN 'ready_check' THEN 'ready_check_scheduled' WHEN 'assessment' THEN 'piesa_scheduled' WHEN 'rectification' THEN 'rectification_booked' WHEN 'installation' THEN 'installation_booked' END;
  IF _stage NOT IN (target,CASE _kind WHEN 'ready_check' THEN 'ready_check_ready_to_schedule' WHEN 'assessment' THEN 'piesa_and_install_window_pending' WHEN 'rectification' THEN 'rectification_scheduling' WHEN 'installation' THEN 'installation_scheduling' END) THEN RAISE EXCEPTION 'Booking stage changed'; END IF;
  UPDATE public.bookings SET status='cancelled' WHERE job_id=_job AND kind::text=_kind AND status::text IN ('proposed','confirmed');
  INSERT INTO public.bookings(job_id,kind,scheduled_start,scheduled_end,contractor_id,assignment_id,business_id,booked_by,status)
  VALUES(_job,_kind::public.booking_kind,_start,CASE WHEN _kind='installation' THEN (((_start AT TIME ZONE 'Australia/Melbourne')::date+time '16:00') AT TIME ZONE 'Australia/Melbourne') ELSE NULL END,
   CASE WHEN _kind IN ('assessment','rectification') THEN w.profile_id ELSE a.user_id END,a.id,business,_actor,'confirmed') RETURNING id INTO new_booking;
  UPDATE public.job_assignments SET booking_confirmed_at=coalesce(booking_confirmed_at,now()) WHERE id=a.id;
  IF j.stage::text<>target THEN
   PERFORM public.commit_guarded_stage(_job,j.stage,target::public.job_stage,_actor,
    _kind||' booked by in-house partner',jsonb_build_object('assignment_id',a.id,'installer_user_id',a.user_id,'installer_business_id',business,'scheduled_start',_start),
    CASE target WHEN 'ready_check_scheduled' THEN 'Ready Check booked' WHEN 'piesa_scheduled' THEN 'Safety check booked' WHEN 'rectification_booked' THEN 'Rectification booked' ELSE 'Installation booked' END);
  ELSE
   INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'booking_rescheduled',_kind||' rescheduled by in-house partner',jsonb_build_object('scheduled_start',_start),false);
  END IF;
 ELSE new_booking:=b.id; END IF;
 IF selected IS NOT NULL THEN
  IF current_crew IS NULL OR (SELECT details->'selection' FROM public.workflow_events WHERE id=current_crew) IS DISTINCT FROM selected THEN
   INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'piisa_crew_selected','Install crew chosen from verified staff',jsonb_build_object('selection',selected,'needs_verification',coalesce(_crew_facts->'needsVerification','[]'),'staff_snapshot',coalesce(_crew_facts->'staff','[]')),true);
  END IF;
  IF old_worker IS NOT NULL AND old_worker<>_worker AND b.id IS NOT NULL THEN
   INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'in_house_lead_changed',
    'Update the ESC install notice: Lead Installer changed to '||w.full_legal_name||' for '||j.job_number||' on '||to_char(b.scheduled_start AT TIME ZONE 'Australia/Melbourne','YYYY-MM-DD'),
    jsonb_build_object('start',b.scheduled_start,'worker_id',_worker,'name',w.full_legal_name,'old_worker_id',old_worker,'booking_id',b.id),true);
  END IF;
 END IF;
 visit:=CASE _kind WHEN 'installation' THEN 'install' WHEN 'crew' THEN 'install' WHEN 'assessment' THEN 'piesa' WHEN 'rectification' THEN 'rectification' ELSE 'ready_check' END;
 INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'visit_allocated','Visit allocated to '||w.full_legal_name,jsonb_build_object('visit',visit,'worker_id',_worker,'worker_name',w.full_legal_name,'business_id',business),true);
 work_details:=jsonb_build_object('type',CASE WHEN _kind='crew' THEN 'crew' ELSE 'booking' END,'kind',_kind,'bookingId',new_booking,'workerId',_worker,'oldWorkerId',old_worker,'start',coalesce(_start,b.scheduled_start),'oldStart',old_start,'selection',selected,'who',jsonb_build_object('id',w.id,'name',w.full_legal_name),'status','pending','attempts',0);
 INSERT INTO public.workflow_events(id,job_id,actor_id,event_type,summary,details,internal) VALUES(_work,_job,_actor,'in_house_saved_work','Saved visit follow-through pending',work_details,true);
 RETURN jsonb_build_object('bookingId',new_booking,'workId',_work,'already',false);
END $$;
REVOKE ALL ON FUNCTION public.commit_in_house_visit(uuid,uuid,text,timestamptz,uuid,text,timestamptz,uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_in_house_visit(uuid,uuid,text,timestamptz,uuid,text,timestamptz,uuid,uuid,jsonb,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_in_house_saved_work(_id uuid,_lease uuid,_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.workflow_events SET details=details||jsonb_build_object('status','running','lease',_lease,'leaseUntil',_now+interval '5 minutes')
 WHERE id=_id AND event_type='in_house_saved_work' AND (details->>'status' IN ('pending','retry') OR (details->>'status'='running' AND (details->>'leaseUntil')::timestamptz<_now));
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_in_house_saved_work(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_in_house_saved_work(uuid,uuid,timestamptz) TO service_role;