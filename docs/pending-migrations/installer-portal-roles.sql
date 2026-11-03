-- PENDING ONLY (new job flow part 5, task 1): proven on PGlite, run live only with Jo's OK. Never apply with code work.
-- 1. business_members.member_role also allows 'office'; new can_see_money (off) lets the boss show Money to an Office person.
-- 2. partner_workers.trade_role gets the value 'office' (no licence or qualification needed).
-- 3. add_team_person_with_identity: one Team function for office / lead / crew / electrician. Mobile and date of birth
--    required for all. Replaces calls to add_team_installer_with_identity (which stays for history).
-- 4. set_member_can_see_money: boss only, writes an admin_config_events row.
-- Safe to run twice. Rollback: installer-portal-roles.rollback.sql.

-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction, so nothing below compares the column to the new
-- value except through ::text.
ALTER TYPE public.assignment_role ADD VALUE IF NOT EXISTS 'office';

ALTER TABLE public.business_members ADD COLUMN IF NOT EXISTS can_see_money boolean NOT NULL DEFAULT false;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.business_members'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%member_role%' LOOP
    EXECUTE format('ALTER TABLE public.business_members DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.business_members ADD CONSTRAINT business_members_member_role_check CHECK (member_role IN ('business_admin','member','office'));

  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.partner_workers'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%property_manager%' LOOP
    EXECUTE format('ALTER TABLE public.partner_workers DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.partner_workers ADD CONSTRAINT partner_workers_trade_role_needs_check CHECK (
    (trade_role = 'electrician' AND licence_number IS NOT NULL) OR (trade_role = 'installer' AND qualification IS NOT NULL)
    OR trade_role = 'property_manager' OR trade_role::text = 'office');
END $$;

CREATE OR REPLACE FUNCTION public.add_team_person_with_identity(_business uuid,_actor uuid,_name text,_role text,_mobile text,_email text,_dob date,_licence text,_rec text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE worker uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') OR NOT EXISTS(
 SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can add this person'; END IF;
 IF _role NOT IN ('office','lead','crew','electrician') OR length(trim(coalesce(_name,'')))<2 THEN RAISE EXCEPTION 'Name and role required'; END IF;
 IF nullif(trim(coalesce(_mobile,'')),'') IS NULL THEN RAISE EXCEPTION 'Mobile required'; END IF;
 IF _dob IS NULL OR _dob>=current_date THEN RAISE EXCEPTION 'Date of birth required and must be before today'; END IF;
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
 INSERT INTO public.partner_worker_identity(worker_id,date_of_birth,updated_by) VALUES(worker,_dob,_actor);
 RETURN worker;
END $$;
REVOKE ALL ON FUNCTION public.add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_member_can_see_money(_business uuid,_actor uuid,_worker uuid,_on boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE w public.partner_workers%ROWTYPE; was boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') OR NOT EXISTS(
 SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can change this'; END IF;
 SELECT * INTO w FROM public.partner_workers WHERE id=_worker AND business_id=_business AND trade_role::text='office' AND removed_at IS NULL;
 IF NOT FOUND OR w.profile_id IS NULL THEN RAISE EXCEPTION 'Office person not found'; END IF;
 SELECT can_see_money INTO was FROM public.business_members WHERE business_id=_business AND user_id=w.profile_id AND member_role='office' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Office person not found'; END IF;
 IF was IS NOT DISTINCT FROM _on THEN RETURN; END IF;
 UPDATE public.business_members SET can_see_money=_on WHERE business_id=_business AND user_id=w.profile_id AND member_role='office';
 INSERT INTO public.admin_config_events(actor_id,event_type,summary,details)
 VALUES(_actor,'member_money_access_changed',CASE WHEN _on THEN 'Office person can now see Money' ELSE 'Office person can no longer see Money' END,
  jsonb_build_object('business_id',_business,'worker_id',_worker,'user_id',w.profile_id,'from',was,'to',_on));
END $$;
REVOKE ALL ON FUNCTION public.set_member_can_see_money(uuid,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_can_see_money(uuid,uuid,uuid,boolean) TO service_role;
