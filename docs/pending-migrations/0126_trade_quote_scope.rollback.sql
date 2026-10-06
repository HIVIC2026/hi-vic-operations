DROP FUNCTION IF EXISTS public.trade_quote_scope(uuid);
DROP POLICY IF EXISTS quote_visibility ON public.quotes;
CREATE POLICY quote_visibility ON public.quotes FOR SELECT TO authenticated
  USING ((public.is_job_owner(job_id, auth.uid()) AND status = ANY (ARRAY['issued'::public.quote_status, 'accepted'::public.quote_status, 'declined'::public.quote_status]))
    OR (kind = 'rectification'::public.quote_kind AND public.job_assignment_role(job_id, auth.uid()) = 'electrician'::public.assignment_role)
    OR (kind = 'installation'::public.quote_kind AND status = 'accepted'::public.quote_status AND public.job_assignment_role(job_id, auth.uid()) = 'installer'::public.assignment_role));
