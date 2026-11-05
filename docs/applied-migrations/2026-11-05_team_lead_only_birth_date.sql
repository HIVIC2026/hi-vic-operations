-- Jo 5 Nov 7:43pm. Lead-only ESC DOB; Office unchanged. No record updates/deletes.
CREATE OR REPLACE FUNCTION public.add_team_person_with_identity(_business uuid,_actor uuid,_name text,_role text,_mobile text,_email text,_dob date,_licence text,_rec text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE worker uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') OR NOT EXISTS(
 SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can add this person'; END IF;
 IF _role NOT IN ('office','lead','crew','electrician') OR length(trim(coalesce(_name,'')))<2 THEN RAISE EXCEPTION 'Name and role required'; END IF;
 IF nullif(trim(coalesce(_mobile,'')),'') IS NULL THEN RAISE EXCEPTION 'Mobile required'; END IF;
 IF _role IN ('lead','office') AND (_dob IS NULL OR _dob>=current_date) THEN RAISE EXCEPTION 'Date of birth required and must be before today'; END IF;
 IF _role='electrician' AND (nullif(trim(coalesce(_licence,'')),'') IS NULL) THEN RAISE EXCEPTION 'Electrical licence number required'; END IF;
 IF _role='electrician' AND (nullif(trim(coalesce(_rec,'')),'') IS NULL) THEN RAISE EXCEPTION 'REC number required'; END IF;
 IF _role='office' THEN
  INSERT INTO public.partner_workers(business_id,full_legal_name,trade_role,mobile,email,approval_status,declarations_due,added_by)
  VALUES(_business,trim(_name),'office'::public.assignment_role,_mobile,_email,'pending',true,_actor) RETURNING id INTO worker;
 ELSIF _role='electrician' THEN
  INSERT INTO public.partner_workers(business_id,full_legal_name,trade_role,mobile,email,licence_number,rec_number,approval_status,declarations_due,added_by)
  VALUES(_business,trim(_name),'electrician',_mobile,_email,trim(_licence),trim(_rec),'pending',true,_actor) RETURNING id INTO worker;
 ELSE
  INSERT INTO public.partner_workers(business_id,full_legal_name,trade_role,worker_role,mobile,email,approval_status,declarations_due,added_by,qualification,certification_status)
  VALUES(_business,trim(_name),'installer',_role,_mobile,_email,'pending',true,_actor,'EEC CII not stated (declared, not verified)','unverified') RETURNING id INTO worker;
 END IF;
 IF _role IN ('lead','office') THEN
  INSERT INTO public.partner_worker_identity(worker_id,date_of_birth,updated_by) VALUES(worker,_dob,_actor);
 END IF;
 RETURN worker;
END $$;
REVOKE ALL ON FUNCTION public.add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.add_team_installer_with_identity(_business uuid,_actor uuid,_name text,_role text,_mobile text,_email text,_dob date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE worker uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') OR NOT EXISTS(
 SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can add this person'; END IF;
 IF _role='lead' AND (_dob IS NULL OR _dob>=current_date) THEN RAISE EXCEPTION 'Date of birth required and must be before today'; END IF;
 IF _role NOT IN ('lead','crew') OR length(trim(_name))<2 THEN RAISE EXCEPTION 'Name and worker role required'; END IF;
 INSERT INTO public.partner_workers(business_id,full_legal_name,trade_role,worker_role,mobile,email,approval_status,declarations_due,added_by,qualification,certification_status)
 VALUES(_business,trim(_name),'installer',_role,_mobile,_email,'pending',true,_actor,'EEC CII not stated (declared, not verified)','unverified') RETURNING id INTO worker;
 IF _role='lead' THEN
  INSERT INTO public.partner_worker_identity(worker_id,date_of_birth,updated_by) VALUES(worker,_dob,_actor);
 END IF;
 RETURN worker;
END $$;
REVOKE ALL ON FUNCTION public.add_team_installer_with_identity(uuid,uuid,text,text,text,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_team_installer_with_identity(uuid,uuid,text,text,text,text,date) TO service_role;
