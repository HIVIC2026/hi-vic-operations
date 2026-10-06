-- Jo 7 Oct SQL mirror of evaluatePaymentGate: upfront amount = safety check payment (not the retired 10%/5% deposit or 3-instalment plan).
CREATE OR REPLACE FUNCTION public.required_deposit_amount(_total numeric) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT least(coalesce((SELECT safety_check_payment_inc_gst FROM public.workflow_settings WHERE id = 1), 349), _total)
$$;
CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT payment_option_gate_enabled FROM public.workflow_settings WHERE id = 1), false)
    AND exists (SELECT 1 FROM public.invoices i JOIN public.jobs j ON j.id = i.job_id
      WHERE i.id = _inv AND public.can_access_job(i.job_id) AND j.channel = 'hivic_sourced'
        AND (i.total_paid >= i.total_inc_gst
          OR i.total_paid >= public.required_deposit_amount(i.total_inc_gst)
          OR exists (SELECT 1 FROM public.payment_overrides o WHERE o.invoice_id = i.id AND o.gate = 'deposit')))
$$;
