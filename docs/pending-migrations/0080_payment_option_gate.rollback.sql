-- Rollback for 0080. First step in production would be leaving payment_option_gate_enabled OFF.
-- Restores the pre-0080 function/view definitions verbatim and removes everything 0080 added.
CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  select exists (select 1 from public.invoices i where i.id = _inv and public.can_access_job(i.job_id)
    and (i.deposit_paid_at is not null or exists (select 1 from public.payment_overrides o where o.invoice_id = i.id and o.gate = 'deposit')))
$function$;

CREATE OR REPLACE VIEW public.invoice_status WITH (security_invoker = true) AS
SELECT id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct, deposit_amount, deposit_due_date,
  deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date, balance_paid_at, total_paid, created_at,
  invoice_deposit_cleared(id) AS deposit_cleared,
  CASE
    WHEN status = ANY (ARRAY['invoice_not_created'::payment_status, 'xero_sync_error'::payment_status]) THEN status
    WHEN total_paid >= total_inc_gst THEN 'fully_paid'::payment_status
    WHEN deposit_paid_at IS NULL AND deposit_due_date < (CURRENT_DATE - 7) THEN 'overdue'::payment_status
    WHEN deposit_paid_at IS NULL THEN 'deposit_due'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date < CURRENT_DATE THEN 'overdue'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date <= CURRENT_DATE THEN 'balance_due'::payment_status
    ELSE 'deposit_paid'::payment_status
  END AS effective_status
FROM public.invoices i;

DROP FUNCTION IF EXISTS public.instalment_plan_active(uuid);
DROP FUNCTION IF EXISTS public.required_deposit_amount(numeric);
DROP TABLE IF EXISTS public.instalment_plans;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS payment_option;
COMMENT ON COLUMN public.invoices.deposit_pct IS NULL;
ALTER TABLE public.workflow_settings DROP COLUMN IF EXISTS payment_option_gate_enabled;
