-- Two-invoice model: one DEPOSIT and one BALANCE invoice per accepted quote.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS part text NOT NULL DEFAULT 'deposit';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS amount_inc_gst numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS xero_update_pending boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_quote_id_key;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_quote_part_key UNIQUE (quote_id, part);

-- Backfill existing (single) invoices as the DEPOSIT invoice.
UPDATE public.invoices SET part = 'deposit', amount_inc_gst = deposit_amount, due_date = deposit_due_date,
  amount_paid = LEAST(total_paid, deposit_amount), paid_at = deposit_paid_at
WHERE amount_inc_gst IS NULL;

-- Backfill a local BALANCE record where an installation date was set or the balance was already paid (local only, no Xero IDs).
INSERT INTO public.invoices (job_id, quote_id, kind, part, status, total_inc_gst, deposit_pct, deposit_amount, deposit_due_date,
  balance_amount, balance_due_date, amount_inc_gst, due_date, amount_paid, paid_at, total_paid, balance_paid_at)
SELECT i.job_id, i.quote_id, i.kind, 'balance',
  CASE WHEN i.total_paid >= i.total_inc_gst THEN 'fully_paid'::payment_status ELSE 'invoice_not_created'::payment_status END,
  i.total_inc_gst, i.deposit_pct, i.deposit_amount, i.deposit_due_date, i.balance_amount, i.balance_due_date,
  i.balance_amount, i.balance_due_date, GREATEST(i.total_paid - i.deposit_amount, 0), i.balance_paid_at,
  GREATEST(i.total_paid - i.deposit_amount, 0), i.balance_paid_at
FROM public.invoices i
WHERE i.part = 'deposit' AND (i.balance_due_date IS NOT NULL OR i.total_paid > i.deposit_amount)
  AND NOT EXISTS (SELECT 1 FROM public.invoices b WHERE b.quote_id = i.quote_id AND b.part = 'balance');

UPDATE public.invoices SET total_paid = amount_paid WHERE part = 'deposit' AND total_paid > amount_paid;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_part_check CHECK (part IN ('deposit','balance'));

GRANT SELECT (part, amount_inc_gst, due_date, amount_paid, paid_at) ON public.invoices TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select exists (select 1 from public.invoices i where i.id = _inv and i.part = 'deposit' and public.can_access_job(i.job_id)
    and (i.deposit_paid_at is not null or exists (select 1 from public.payment_overrides o where o.invoice_id = i.id and o.gate = 'deposit')))
$$;

CREATE OR REPLACE FUNCTION public.job_deposit_cleared(_job uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select coalesce((select public.invoice_deposit_cleared(i.id) from public.invoices i
    where i.job_id = _job and i.kind = 'installation' and i.part = 'deposit' order by i.created_at desc limit 1), false)
  and public.can_access_job(_job)
$$;

CREATE OR REPLACE VIEW public.invoice_status WITH (security_invoker = true) AS
 SELECT id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct, deposit_amount,
    deposit_due_date, deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date, balance_paid_at, total_paid, created_at,
    invoice_deposit_cleared(id) AS deposit_cleared,
    CASE
      WHEN status = ANY (ARRAY['invoice_not_created'::payment_status, 'xero_sync_error'::payment_status]) AND amount_paid < amount_inc_gst THEN status
      WHEN part = 'deposit' AND amount_paid >= amount_inc_gst THEN 'deposit_paid'::payment_status
      WHEN part = 'deposit' AND due_date < (CURRENT_DATE - 7) THEN 'overdue'::payment_status
      WHEN part = 'deposit' THEN 'deposit_due'::payment_status
      WHEN amount_paid >= amount_inc_gst THEN 'fully_paid'::payment_status
      WHEN due_date IS NULL THEN 'invoice_created'::payment_status
      WHEN due_date < CURRENT_DATE THEN 'overdue'::payment_status
      ELSE 'balance_due'::payment_status
    END AS effective_status,
    part, amount_inc_gst, due_date, amount_paid, paid_at
   FROM invoices i;

CREATE OR REPLACE VIEW public.invoice_payment_state WITH (security_invoker = true) AS
 SELECT id, job_id, quote_id, kind, status, xero_contact_id, xero_invoice_id, xero_invoice_number, xero_reference, xero_online_url,
    total_inc_gst, deposit_pct, deposit_amount, deposit_due_date, deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date,
    total_paid, last_synced_at, last_sync_error, created_at, updated_at,
    (((deposit_paid_at IS NOT NULL) OR (EXISTS (SELECT 1 FROM payment_overrides o WHERE o.invoice_id = i.id AND o.gate = 'deposit'))) AND part = 'deposit') AS deposit_cleared,
    (SELECT s.effective_status FROM invoice_status s WHERE s.id = i.id) AS effective_status,
    part, amount_inc_gst, due_date, amount_paid, paid_at, xero_update_pending
   FROM invoices i;