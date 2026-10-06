-- Security review C (Jo, 6 Oct): trades can no longer read quote rows (customer prices/discount).
-- Owners keep their issued/accepted/declined quotes; office keeps admin_all.
DROP POLICY IF EXISTS quote_visibility ON public.quotes;
CREATE POLICY quote_visibility ON public.quotes FOR SELECT TO authenticated
  USING (public.is_job_owner(job_id, auth.uid()) AND status = ANY (ARRAY['issued'::public.quote_status, 'accepted'::public.quote_status, 'declined'::public.quote_status]));

-- Narrow trade view: scope lines only (description, quantity) of the accepted installation quote (installer)
-- or the current rectification quote (electrician). Never prices, discount, totals or margins.
CREATE OR REPLACE FUNCTION public.trade_quote_scope(_job uuid)
RETURNS TABLE (quote_kind public.quote_kind, quote_status public.quote_status, description text, quantity numeric, sort integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.kind, q.status, i.description, i.quantity, i.sort
  FROM public.quotes q JOIN public.quote_items i ON i.quote_id = q.id
  WHERE q.job_id = _job
    AND ((q.kind = 'installation' AND q.status = 'accepted' AND public.job_assignment_role(_job, auth.uid()) = 'installer')
      OR (q.kind = 'rectification' AND q.status <> 'superseded' AND public.job_assignment_role(_job, auth.uid()) = 'electrician'))
  ORDER BY q.kind, i.sort
$$;
REVOKE ALL ON FUNCTION public.trade_quote_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trade_quote_scope(uuid) TO authenticated;
