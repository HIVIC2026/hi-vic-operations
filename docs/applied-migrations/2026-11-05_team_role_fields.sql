-- Atomic business-owned Team Add/Edit; no provider calls, invitations or verification grants.
CREATE OR REPLACE FUNCTION public.save_team_person_details(_business uuid,_actor uuid,_worker uuid,_name text,_role text,_mobile text,_email text,_dob date,_licence text,_rec text,_certificate jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE w public.partner_workers%ROWTYPE; worker uuid; cert jsonb; old_dob date;
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can save this person'; END IF;
 IF _role NOT IN ('office','lead','crew','electrician') OR length(trim(coalesce(_name,'')))<2 THEN RAISE EXCEPTION 'Name and role required'; END IF;
 IF nullif(trim(coalesce(_mobile,'')),'') IS NULL THEN RAISE EXCEPTION 'Mobile required'; END IF;
 IF _role IN ('office','electrician') AND nullif(trim(coalesce(_email,'')),'') IS NULL THEN RAISE EXCEPTION 'Email required'; END IF;
 IF _worker IS NOT NULL THEN
  SELECT * INTO w FROM public.partner_workers WHERE id=_worker AND business_id=_business AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team member not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=w.profile_id AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Cannot edit the business owner here'; END IF;
  IF (CASE WHEN w.trade_role::text='installer' THEN coalesce(w.worker_role,'lead') ELSE w.trade_role::text END)<>_role THEN RAISE EXCEPTION 'Use the existing role change action'; END IF;
  SELECT date_of_birth INTO old_dob FROM public.partner_worker_identity WHERE worker_id=_worker;
 END IF;
 IF _role IN ('lead','crew') AND (coalesce(_dob,old_dob) IS NULL OR coalesce(_dob,old_dob)>=current_date) THEN RAISE EXCEPTION 'Date of birth required and must be before today'; END IF;
 IF _role='electrician' AND (nullif(trim(coalesce(_licence,'')),'') IS NULL OR nullif(trim(coalesce(_rec,'')),'') IS NULL) THEN RAISE EXCEPTION 'Licence and REC required'; END IF;
 cert:=coalesce(w.certification,'{}'::jsonb);
 IF _role IN ('lead','crew') THEN
  IF _certificate IS NOT NULL THEN
   IF nullif(trim(coalesce(_certificate->>'number','')),'') IS NULL OR NOT starts_with(coalesce(_certificate->>'path',''),'team-certificates/'||_business::text||'/') OR position('..' in (_certificate->>'path'))>0 THEN RAISE EXCEPTION 'Certificate number and photo required'; END IF;
   cert:=cert||jsonb_build_object('eec_upload',_certificate);
  END IF;
  IF nullif(trim(coalesce(cert->'eec_upload'->>'number','')),'') IS NULL OR nullif(trim(coalesce(cert->'eec_upload'->>'path','')),'') IS NULL THEN RAISE EXCEPTION 'Certificate number and photo required'; END IF;
 END IF;
 IF _worker IS NULL THEN
  INSERT INTO public.partner_workers(business_id,full_legal_name,trade_role,worker_role,mobile,email,licence_number,rec_number,qualification,certification,certification_status,approval_status,declarations_due,added_by)
  VALUES(_business,trim(_name),(CASE WHEN _role IN ('lead','crew') THEN 'installer' ELSE _role END)::public.assignment_role,CASE WHEN _role IN ('lead','crew') THEN _role ELSE NULL END,trim(_mobile),nullif(lower(trim(_email)),''),CASE WHEN _role='electrician' THEN trim(_licence) ELSE NULL END,CASE WHEN _role='electrician' THEN trim(_rec) ELSE NULL END,CASE WHEN _role IN ('lead','crew') THEN 'EEC CII declared, not verified' ELSE NULL END,cert,'unverified','pending',false,_actor) RETURNING id INTO worker;
 ELSE
  worker:=_worker;
  UPDATE public.partner_workers SET full_legal_name=trim(_name),mobile=trim(_mobile),email=nullif(lower(trim(_email)),''),
   licence_number=CASE WHEN _role='electrician' THEN trim(_licence) ELSE licence_number END,rec_number=CASE WHEN _role='electrician' THEN trim(_rec) ELSE rec_number END,
   certification=cert,certification_status=CASE WHEN _certificate IS NOT NULL THEN 'unverified' ELSE certification_status END,
   licence_verified_at=CASE WHEN _role='electrician' AND (licence_number IS DISTINCT FROM trim(_licence) OR rec_number IS DISTINCT FROM trim(_rec)) THEN NULL ELSE licence_verified_at END
  WHERE id=worker;
 END IF;
 IF _role IN ('lead','crew') AND _dob IS NOT NULL THEN
  INSERT INTO public.partner_worker_identity(worker_id,date_of_birth,updated_by) VALUES(worker,_dob,_actor)
  ON CONFLICT(worker_id) DO UPDATE SET date_of_birth=excluded.date_of_birth,updated_by=excluded.updated_by;
 END IF;
 INSERT INTO public.admin_config_events(actor_id,event_type,summary,details) VALUES(_actor,'team_person_details_saved','Team person details saved',jsonb_build_object('worker_id',worker,'business_id',_business,'role',_role,'created',_worker IS NULL,'certificate_changed',_certificate IS NOT NULL,'birth_date_changed',_dob IS NOT NULL));
 RETURN worker;
END $$;
REVOKE ALL ON FUNCTION public.save_team_person_details(uuid,uuid,uuid,text,text,text,text,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_person_details(uuid,uuid,uuid,text,text,text,text,date,text,text,jsonb) TO service_role;