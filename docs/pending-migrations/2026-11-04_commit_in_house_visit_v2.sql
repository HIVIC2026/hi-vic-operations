-- Join (4 Nov 2026, after Part 6 fix wave C1): electricians never log in, so a verified Team electrician has no profile.
-- v2 of commit_in_house_visit drops the `w.profile_id IS NULL` test from the electrician check (the same test
-- 2026-11-03_allocate_team_electrician_v2.sql dropped): without it the installer office's atomic PIESA / upgrades-day
-- booking for a no-login Team electrician was refused "Electrician not verified". The booking's contractor_id stays the
-- worker's profile when they happen to have one, else NULL (exactly what the inline confirmBooking path writes); the
-- allocation event's worker_id names the person. Every other guard is unchanged. Apply AFTER 2026-11-01_in_house_saved_work.sql
-- and 2026-11-03_allocate_team_electrician_v2.sql. Rollback: 2026-11-04_commit_in_house_visit_v2.rollback.sql (the exact prior body; G6 N4).
-- Proven on PGlite: tests/journey-a1-complete-route-db.test.ts (step 5).
-- Fix wave J5 (4 Nov 2026, Part 9 Task 10 ruling): an installation booking is accepted while the job is at piesa_complete /
-- rectification_scheduling / rectification_booked (the upgrades day still to come) — recorded with no stage move
-- (`install_booked_before_upgrades` history row); autoadvance moves the stage once the Part C is recorded. The TS path
-- (booking.server validateBooking / confirmBooking) has the same rule. CHANGED again — re-apply at go-live.
-- Fix wave J4 G2 (4 Nov 2026): booking the PIESA (assessment) or the upgrades (rectification) visit for a Team electrician
-- also records the owner-contact release for that assignment + visit (`contact_releases`, the same audited rule as an
-- accepted offer — Jo 21 Oct), so the electrician's /e/ link shows the owner's name, phone and address from the booking.
-- Idempotent on (assignment_id, visit_kind). The TS fallback (in-house-inline-save.server) writes the identical row.
-- G7 (Jo 4 Nov 2026, pack 2 batch 4): a Ready Check may be booked with "Not sure yet" for who's going (`_worker` NULL,
-- ready_check ONLY — every other kind still needs its person): no visit_allocated row, a `ready_check_person_pending`
-- history row names the booking, the saved work carries workerId/who null (no Mitti form, no owner notice until the
-- person is picked). Picking the person = the same call with the same start and the worker: the booking is re-recorded
-- with a "Ready Check: who's going picked" history line (not "rescheduled"), visit_allocated, and the saved work makes
-- the form and sends the owner's "You're booked". CHANGED again — re-apply at go-live.
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
 IF _worker IS NULL THEN
  IF _kind<>'ready_check' THEN RAISE EXCEPTION 'Choose the person going.'; END IF;
 ELSE
  SELECT * INTO w FROM public.partner_workers WHERE id=_worker AND business_id=business AND removed_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not your Team member'; END IF;
 END IF;
 SELECT id,(details->'selection'->>'lead')::uuid INTO current_crew,old_worker FROM public.workflow_events
 WHERE job_id=_job AND event_type='piisa_crew_selected' ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO b FROM public.bookings WHERE job_id=_job AND kind::text=CASE WHEN _kind='crew' THEN 'installation' ELSE _kind END AND status::text='confirmed' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 -- An exact successful replay is a no-op even when another office user clicked.
 IF EXISTS(SELECT 1 FROM public.workflow_events WHERE id=_work AND job_id=_job AND event_type='in_house_saved_work'
  AND details->>'workerId' IS NOT DISTINCT FROM _worker::text AND details->>'kind'=_kind
  AND (_kind='crew' OR (details->>'start')::timestamptz=_start)
  AND coalesce(details->'selection','null'::jsonb)=coalesce(_selection,'null'::jsonb)) THEN
  RETURN jsonb_build_object('bookingId',b.id,'already',true,'workId',_work); END IF;
 IF _kind<>'crew' AND b.id IS NOT NULL AND b.scheduled_start=_start AND
  EXISTS(SELECT 1 FROM public.workflow_events WHERE job_id=_job AND event_type='in_house_saved_work' AND details->>'bookingId'=b.id::text AND details->>'workerId' IS NOT DISTINCT FROM _worker::text AND coalesce(details->'selection','null'::jsonb)=coalesce(_selection,'null'::jsonb)) THEN
  RETURN (SELECT jsonb_build_object('bookingId',b.id,'already',true,'workId',id) FROM public.workflow_events
   WHERE job_id=_job AND event_type='in_house_saved_work' AND details->>'bookingId'=b.id::text AND details->>'workerId' IS NOT DISTINCT FROM _worker::text ORDER BY created_at DESC LIMIT 1); END IF;
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
  IF w.trade_role::text<>'electrician' OR w.approval_status::text IS DISTINCT FROM 'approved'
   OR nullif(trim(w.licence_number),'') IS NULL OR nullif(trim(w.rec_number),'') IS NULL OR w.licence_verified_at IS NULL
   OR w.licence_expires_on IS NULL OR w.licence_expires_on<(now() AT TIME ZONE 'Australia/Melbourne')::date THEN RAISE EXCEPTION 'Electrician not verified'; END IF;
  PERFORM public.allocate_team_electrician(_job,_actor,_worker);
  SELECT * INTO a FROM public.job_assignments WHERE job_id=_job AND role::text='electrician' AND active FOR UPDATE;
 ELSIF _kind<>'ready_check' THEN RAISE EXCEPTION 'Unknown booking kind'; END IF;
 old_start:=b.scheduled_start;
 IF _kind<>'crew' THEN
  target:=CASE _kind WHEN 'ready_check' THEN 'ready_check_scheduled' WHEN 'assessment' THEN 'piesa_scheduled' WHEN 'rectification' THEN 'rectification_booked' WHEN 'installation' THEN 'installation_booked' END;
  -- Part 9 Task 10 ruling (4 Nov 2026): the install may be booked before the upgrades day (piesa_complete / rectification
  -- scheduling / rectification booked) — recorded at the current stage, no stage move (validateBooking has already allowed it).
  IF _stage NOT IN (target,CASE _kind WHEN 'ready_check' THEN 'ready_check_ready_to_schedule' WHEN 'assessment' THEN 'piesa_and_install_window_pending' WHEN 'rectification' THEN 'rectification_scheduling' WHEN 'installation' THEN 'installation_scheduling' END)
   AND NOT (_kind='installation' AND _stage IN ('piesa_complete','rectification_scheduling','rectification_booked')) THEN RAISE EXCEPTION 'Booking stage changed'; END IF;
  UPDATE public.bookings SET status='cancelled' WHERE job_id=_job AND kind::text=_kind AND status::text IN ('proposed','confirmed');
  INSERT INTO public.bookings(job_id,kind,scheduled_start,scheduled_end,contractor_id,assignment_id,business_id,booked_by,status)
  VALUES(_job,_kind::public.booking_kind,_start,CASE WHEN _kind='installation' THEN (((_start AT TIME ZONE 'Australia/Melbourne')::date+time '16:00') AT TIME ZONE 'Australia/Melbourne') ELSE NULL END,
   CASE WHEN _kind IN ('assessment','rectification') THEN w.profile_id ELSE a.user_id END,a.id,business,_actor,'confirmed') RETURNING id INTO new_booking;
  UPDATE public.job_assignments SET booking_confirmed_at=coalesce(booking_confirmed_at,now()) WHERE id=a.id;
  IF _kind IN ('assessment','rectification') THEN
   INSERT INTO public.contact_releases(job_id,assignment_id,visit_kind,released_by,owner_notice,trade_notice)
   VALUES(_job,a.id,CASE _kind WHEN 'assessment' THEN 'piesa' ELSE 'rectification' END,_actor,
    'To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.',
    'Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.')
   ON CONFLICT (assignment_id,visit_kind) DO NOTHING;
  END IF;
  IF _kind='installation' AND j.stage::text IN ('piesa_complete','rectification_scheduling','rectification_booked') THEN
   INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,
    CASE WHEN b.id IS NULL THEN 'install_booked_before_upgrades' ELSE 'booking_rescheduled' END,
    CASE WHEN b.id IS NULL THEN 'Installation booked by in-house partner before the upgrades day (the job stays at '||j.stage::text||' until the Part C and certificate are in)' ELSE 'installation rescheduled by in-house partner' END,
    jsonb_build_object('assignment_id',a.id,'installer_user_id',a.user_id,'installer_business_id',business,'scheduled_start',_start,'stage',j.stage::text),true);
  ELSIF j.stage::text<>target THEN
   PERFORM public.commit_guarded_stage(_job,j.stage,target::public.job_stage,_actor,
    _kind||' booked by in-house partner',jsonb_build_object('assignment_id',a.id,'installer_user_id',a.user_id,'installer_business_id',business,'scheduled_start',_start),
    CASE target WHEN 'ready_check_scheduled' THEN 'Ready Check booked' WHEN 'piesa_scheduled' THEN 'Safety check booked' WHEN 'rectification_booked' THEN 'Rectification booked' ELSE 'Installation booked' END);
  ELSE
   INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'booking_rescheduled',
    CASE WHEN _kind='ready_check' AND b.scheduled_start=_start AND _worker IS NOT NULL THEN 'Ready Check: who''s going picked ('||w.full_legal_name||')' ELSE _kind||' rescheduled by in-house partner' END,
    jsonb_build_object('scheduled_start',_start,'person_picked',(_kind='ready_check' AND b.scheduled_start=_start AND _worker IS NOT NULL)),false);
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
 IF _worker IS NULL THEN
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'ready_check_person_pending','Ready Check booked — who''s going not picked yet',jsonb_build_object('booking_id',new_booking,'start',_start,'business_id',business),true);
 ELSE
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(_job,_actor,'visit_allocated','Visit allocated to '||w.full_legal_name,jsonb_build_object('visit',visit,'worker_id',_worker,'worker_name',w.full_legal_name,'business_id',business),true);
 END IF;
 work_details:=jsonb_build_object('type',CASE WHEN _kind='crew' THEN 'crew' ELSE 'booking' END,'kind',_kind,'bookingId',new_booking,'workerId',_worker,'oldWorkerId',old_worker,'start',coalesce(_start,b.scheduled_start),'oldStart',old_start,'selection',selected,'who',CASE WHEN _worker IS NULL THEN NULL ELSE jsonb_build_object('id',w.id,'name',w.full_legal_name,'phone',to_jsonb(w)->>'mobile') END,'status','pending','attempts',0);
 INSERT INTO public.workflow_events(id,job_id,actor_id,event_type,summary,details,internal) VALUES(_work,_job,_actor,'in_house_saved_work','Saved visit follow-through pending',work_details,true);
 RETURN jsonb_build_object('bookingId',new_booking,'workId',_work,'already',false);
END $$;
REVOKE ALL ON FUNCTION public.commit_in_house_visit(uuid,uuid,text,timestamptz,uuid,text,timestamptz,uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_in_house_visit(uuid,uuid,text,timestamptz,uuid,text,timestamptz,uuid,uuid,jsonb,jsonb,uuid) TO service_role;
