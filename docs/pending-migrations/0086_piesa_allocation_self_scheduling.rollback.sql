DROP FUNCTION IF EXISTS public.accept_partner_offer(uuid, uuid);
DROP POLICY IF EXISTS owner_or_assignee ON public.owners;
CREATE POLICY owner_or_assignee ON public.owners FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.owner_id = owners.id AND public.job_assignment_role(j.id, auth.uid()) IS NOT NULL));
DROP TRIGGER IF EXISTS job_assignments_release_contact ON public.job_assignments;
DROP FUNCTION IF EXISTS public.release_contact_on_assign();
DROP TRIGGER IF EXISTS job_assignments_revoke_release ON public.job_assignments;
DROP FUNCTION IF EXISTS public.revoke_contact_release_on_end();
DROP FUNCTION IF EXISTS public.has_contact_release(uuid, uuid);
DROP TABLE IF EXISTS public.contact_releases;
