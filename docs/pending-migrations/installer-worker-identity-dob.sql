-- PENDING ONLY (new job flow part 5, task 10b): proven on PGlite, run live only with Jo's OK. Never apply with code work.
-- The boss adds a date of birth for an EXISTING Team person (added before dates of birth were asked, or whose row was
-- made by an older path). Same privacy shape as add_team_installer_with_identity (0186) / add_team_person_with_identity:
-- the date goes only into partner_worker_identity, the caller must be the worker's own business admin (never qa_office),
-- and one admin_config_events row records that it was set — never the date itself. Service-role only.
-- Safe to run twice. Rollback: installer-worker-identity-dob.rollback.sql.
CREATE OR REPLACE FUNCTION public.set_worker_identity_dob(p_worker uuid, p_dob date, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE w public.partner_workers%ROWTYPE; had boolean;
BEGIN
 SELECT * INTO w FROM public.partner_workers WHERE id=p_worker AND removed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Team member not found'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role::text='qa_office') OR NOT EXISTS(
 SELECT 1 FROM public.business_members WHERE business_id=w.business_id AND user_id=p_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can set this'; END IF;
 IF p_dob IS NULL OR p_dob>=current_date THEN RAISE EXCEPTION 'Date of birth required and must be before today'; END IF;
 had := EXISTS(SELECT 1 FROM public.partner_worker_identity WHERE worker_id=w.id);
 INSERT INTO public.partner_worker_identity(worker_id,date_of_birth,updated_by,updated_at) VALUES(w.id,p_dob,p_actor,now())
 ON CONFLICT (worker_id) DO UPDATE SET date_of_birth=EXCLUDED.date_of_birth, updated_by=EXCLUDED.updated_by, updated_at=now();
 INSERT INTO public.admin_config_events(actor_id,event_type,summary,details)
 VALUES(p_actor,'worker_identity_dob_set',CASE WHEN had THEN 'Date of birth replaced for a team member' ELSE 'Date of birth added for a team member' END,
  jsonb_build_object('business_id',w.business_id,'worker_id',w.id,'had_dob',had));
END $$;
REVOKE ALL ON FUNCTION public.set_worker_identity_dob(uuid,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_worker_identity_dob(uuid,date,uuid) TO service_role;
