ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS payment_option_gate_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_option text
  CHECK (payment_option IS NULL OR payment_option IN ('deposit_paid','paid_in_full','instalment_plan_active','office_override'));
COMMENT ON COLUMN public.invoices.deposit_pct IS 'Configured minimum upfront deposit fraction (0.10 under $20,000, 0.05 at/over). Legacy rows may hold the retired 0.5.';

CREATE TABLE public.instalment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','cancelled','failed','overdue','superseded')),
  instalment_count integer NOT NULL DEFAULT 3 CHECK (instalment_count = 3),
  office_approved_by uuid, office_approved_at timestamptz,
  owner_accepted_by uuid, owner_accepted_at timestamptz,
  first_instalment_amount numeric, first_instalment_verified_at timestamptz,
  collection_arrangement text, collection_recorded_at timestamptz,
  status_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instalment_plans_one_active ON public.instalment_plans(invoice_id) WHERE status = 'active';
GRANT SELECT ON public.instalment_plans TO authenticated;
GRANT ALL ON public.instalment_plans TO service_role;
ALTER TABLE public.instalment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Office and the job owner read instalment plans" ON public.instalment_plans FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_job_owner(job_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.required_deposit_amount(_total numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round(ceil(round(_total * 100) * CASE WHEN _total >= 20000 THEN 5 ELSE 10 END / 100.0) / 100, 2)
$$;

CREATE OR REPLACE FUNCTION public.instalment_plan_active(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT exists (SELECT 1 FROM public.instalment_plans p JOIN public.invoices i ON i.id = p.invoice_id
    WHERE p.invoice_id = _inv AND p.quote_id = i.quote_id AND p.status = 'active' AND p.instalment_count = 3
      AND p.office_approved_at IS NOT NULL AND p.owner_accepted_at IS NOT NULL
      AND p.first_instalment_verified_at IS NOT NULL AND p.collection_recorded_at IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT payment_option_gate_enabled FROM public.workflow_settings WHERE id = 1), false)
    AND exists (SELECT 1 FROM public.invoices i JOIN public.jobs j ON j.id = i.job_id
      WHERE i.id = _inv AND public.can_access_job(i.job_id) AND j.channel = 'hivic_sourced'
        AND (i.total_paid >= i.total_inc_gst
          OR i.total_paid >= public.required_deposit_amount(i.total_inc_gst)
          OR public.instalment_plan_active(i.id)
          OR exists (SELECT 1 FROM public.payment_overrides o WHERE o.invoice_id = i.id AND o.gate = 'deposit')))
$$;

CREATE OR REPLACE VIEW public.invoice_status WITH (security_invoker = true) AS
SELECT id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct, deposit_amount, deposit_due_date,
  deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date, balance_paid_at, total_paid, created_at,
  public.invoice_deposit_cleared(id) AS deposit_cleared,
  CASE
    WHEN status = ANY (ARRAY['invoice_not_created'::payment_status, 'xero_sync_error'::payment_status]) THEN status
    WHEN total_paid >= total_inc_gst THEN 'fully_paid'::payment_status
    WHEN NOT public.invoice_deposit_cleared(id) AND deposit_due_date < (CURRENT_DATE - 7) THEN 'overdue'::payment_status
    WHEN NOT public.invoice_deposit_cleared(id) THEN 'deposit_due'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date < CURRENT_DATE THEN 'overdue'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date <= CURRENT_DATE THEN 'balance_due'::payment_status
    ELSE 'deposit_paid'::payment_status
  END AS effective_status
FROM public.invoices i;