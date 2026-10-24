-- Jo 24 Oct 2026: one payment rule for both job routes — the $349 safety check payment (workflow_settings.
-- safety_check_payment_inc_gst) before the PIESA. SQL mirror of evaluatePaymentGate (payment-gate.core.ts):
-- supersedes 0131 (which still limited the mirror to hivic_sourced) and drops the retired 10%/5% deposit maths
-- and the retired 3-instalment plan from the mirror. Unknown sources stay blocked. Display/RLS mirror only;
-- the TS gate remains the guard.
CREATE OR REPLACE FUNCTION public.required_deposit_amount(_total numeric) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT least(coalesce((SELECT safety_check_payment_inc_gst FROM public.workflow_settings WHERE id = 1), 349), _total)
$$;
CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT payment_option_gate_enabled FROM public.workflow_settings WHERE id = 1), false)
    AND exists (SELECT 1 FROM public.invoices i JOIN public.jobs j ON j.id = i.job_id
      WHERE i.id = _inv AND public.can_access_job(i.job_id) AND j.channel IN ('hivic_sourced', 'installer_sourced')
        AND (i.total_paid >= i.total_inc_gst
          OR i.total_paid >= public.required_deposit_amount(i.total_inc_gst)
          OR exists (SELECT 1 FROM public.payment_overrides o WHERE o.invoice_id = i.id AND o.gate = 'deposit')))
$$;
