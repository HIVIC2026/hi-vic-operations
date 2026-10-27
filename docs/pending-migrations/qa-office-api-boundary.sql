-- Default denial at the Data API also covers owner-context views and SECURITY DEFINER RPCs.
-- Existing admin/trade/owner requests return immediately; their helpers/policies are unchanged.
CREATE OR REPLACE FUNCTION public.qa_office_has_role()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text='qa_office')
$$;
REVOKE ALL ON FUNCTION public.qa_office_has_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qa_office_has_role() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.qa_office_api_boundary()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE path text := current_setting('request.path',true); method text := current_setting('request.method',true);
BEGIN
 IF NOT public.qa_office_has_role() THEN RETURN; END IF;
 IF NOT public.is_qa_office() THEN RAISE EXCEPTION 'Not available for the TEST office login' USING ERRCODE='42501'; END IF;
 -- Job actions use audited server entrypoints, never direct browser writes. Lists start from RLS-scoped jobs.
 IF (method IN ('GET','HEAD') AND path IN ('/jobs','/profiles','/user_roles','/business_members'))
   OR (method IN ('GET','HEAD','POST') AND path IN ('/rpc/get_my_profile','/rpc/is_qa_office','/rpc/qa_office_job_allowed','/rpc/qa_office_business_allowed')) THEN RETURN; END IF;
 RAISE EXCEPTION 'Not available for the TEST office login' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.qa_office_api_boundary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qa_office_api_boundary() TO authenticated,anon,service_role;

-- Deny access to other users' roles, and every role write, even if a permissive policy is added later.
CREATE POLICY qa_office_roles_scope ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated
 USING (NOT (SELECT public.qa_office_has_role()) OR user_id=(SELECT auth.uid()));
CREATE POLICY qa_office_roles_insert_denied ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (NOT (SELECT public.qa_office_has_role()));
CREATE POLICY qa_office_roles_update_denied ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (NOT (SELECT public.qa_office_has_role())) WITH CHECK (NOT (SELECT public.qa_office_has_role()));
CREATE POLICY qa_office_roles_delete_denied ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated
 USING (NOT (SELECT public.qa_office_has_role()));

-- Protect private storage independently from Data API policies. Never expose evidence URLs to this role directly.
CREATE POLICY qa_office_storage_quarantine ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT (SELECT public.qa_office_has_role())) WITH CHECK (NOT (SELECT public.qa_office_has_role()));

-- Refuse installation if another configured pre-request hook would be replaced.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
   CROSS JOIN LATERAL unnest(s.setconfig) c WHERE r.rolname='authenticator'
   AND c LIKE 'pgrst.db_pre_request=%' AND c <> 'pgrst.db_pre_request=public.qa_office_api_boundary') THEN
   RAISE EXCEPTION 'Existing Data API pre-request hook must be preserved';
 END IF;
END $$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.qa_office_api_boundary';
NOTIFY pgrst, 'reload config';