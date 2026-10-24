-- Restores the live definitions captured 24 Oct 2026 before 0223.
CREATE OR REPLACE FUNCTION public.required_deposit_amount(_total numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round(ceil(round(_total * 100) * CASE WHEN _total >= 20000 THEN 5 ELSE 10 END / 100.0) / 100, 2)
$$;
CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT payment_option_gate_enabled FROM public.workflow_settings WHERE id = 1), false)
    AND exists (SELECT 1 FROM public.invoices i JOIN public.jobs j ON j.id = i.job_id
      WHERE i.id = _inv AND public.can_access_job(i.job_id) AND j.channel = 'hivic_sourced'
        AND (i.total_paid >= i.total_inc_gst
          OR i.total_paid >= public.required_deposit_amount(i.total_inc_gst)
          OR public.instalment_plan_active(i.id)
          OR exists (SELECT 1 FROM public.payment_overrides o WHERE o.invoice_id = i.id AND o.gate = 'deposit')))
$$;
