-- NOT APPLIED: TEST office foundation only. Keep is_admin(), can_access_job() and my_job_role() unchanged.
-- Do not create the login or enable office screens until every privileged office entrypoint is scoped.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qa_office';

CREATE OR REPLACE FUNCTION public.is_qa_office()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.user_id = (SELECT auth.uid()) AND r.role::text = 'qa_office'
      AND u.email_confirmed_at IS NOT NULL
      AND u.email ~* '^[^@[:space:]]+@hivic-test[.]example$'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = (SELECT auth.uid()) AND r.role::text <> 'qa_office'
  )
$$;
REVOKE ALL ON FUNCTION public.is_qa_office() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_qa_office() TO authenticated, service_role;

-- A restrictive quarantine supplements all existing permissive policies, including unrelated membership policies.
-- No business data is opened by this foundation; scope policies must be proven before replacing this quarantine.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND c.relname NOT IN ('profiles', 'user_roles')
  LOOP
    EXECUTE format('CREATE POLICY qa_office_quarantine ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = ''qa_office'')) WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = ''qa_office''))', t.relname);
  END LOOP;
END $$;

-- The only exception is reading one's own sign-in profile and persisted role; no writes, other people or roles.
CREATE POLICY qa_office_self_profile_quarantine ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = 'qa_office') OR id = (SELECT auth.uid()));
CREATE POLICY qa_office_profile_write_quarantine ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = 'qa_office'));
CREATE POLICY qa_office_profile_update_quarantine ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = 'qa_office'))
WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = 'qa_office'));
CREATE POLICY qa_office_profile_delete_quarantine ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated
USING (NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role::text = 'qa_office'));