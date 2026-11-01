-- PENDING ONLY: Jo 2 Nov. Never apply as part of the morning code work.
CREATE TABLE public.partner_worker_identity (
 worker_id uuid PRIMARY KEY REFERENCES public.partner_workers(id) ON DELETE CASCADE,
 date_of_birth date NOT NULL,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_worker_identity TO authenticated;
GRANT ALL ON public.partner_worker_identity TO service_role;
ALTER TABLE public.partner_worker_identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_identity_private_read ON public.partner_worker_identity FOR SELECT TO authenticated USING (
 NOT (SELECT has_role((SELECT auth.uid()),'qa_office'::public.app_role)) AND
 ((SELECT is_admin()) OR EXISTS (
 SELECT 1 FROM public.partner_workers w JOIN public.business_members m ON m.business_id=w.business_id
 WHERE w.id=worker_id AND w.removed_at IS NULL AND m.user_id=(SELECT auth.uid()) AND m.active AND m.member_role::text='business_admin'))
);
CREATE OR REPLACE FUNCTION public.add_team_installer_with_identity(_business uuid,_actor uuid,_name text,_role text,_mobile text,_email text,_dob date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE worker uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') OR NOT EXISTS(
 SELECT 1 FROM public.business_members WHERE business_id=_business AND user_id=_actor AND active AND member_role::text='business_admin') THEN RAISE EXCEPTION 'Only the business admin can add this person'; END IF;
 IF _dob IS NULL OR _dob>=current_date THEN RAISE EXCEPTION 'Date of birth required and must be before today'; END IF;
 IF _role NOT IN ('lead','crew') OR length(trim(_name))<2 THEN RAISE EXCEPTION 'Name and worker role required'; END IF;
 INSERT INTO public.partner_workers(business_id,full_legal_name,trade_role,worker_role,mobile,email,approval_status,declarations_due,added_by,qualification,certification_status)
 VALUES(_business,trim(_name),'installer',_role,_mobile,_email,'pending',true,_actor,'EEC CII not stated (declared, not verified)','unverified') RETURNING id INTO worker;
 INSERT INTO public.partner_worker_identity(worker_id,date_of_birth,updated_by) VALUES(worker,_dob,_actor);
 RETURN worker;
END $$;
REVOKE ALL ON FUNCTION public.add_team_installer_with_identity(uuid,uuid,text,text,text,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_team_installer_with_identity(uuid,uuid,text,text,text,text,date) TO service_role;