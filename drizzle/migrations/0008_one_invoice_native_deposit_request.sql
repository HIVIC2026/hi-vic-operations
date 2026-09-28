-- Revert two-invoice model to ONE full invoice per accepted quote; add native Xero deposit-request tracking (admin-only).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_quote_part_key;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_part_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_quote_id_key UNIQUE (quote_id);

REVOKE SELECT (part, amount_inc_gst, due_date, amount_paid, paid_at) ON public.invoices FROM authenticated;
COMMENT ON COLUMN public.invoices.part IS 'DEPRECATED: two-invoice model reverted; one invoice per quote';
COMMENT ON COLUMN public.invoices.amount_inc_gst IS 'DEPRECATED: use total_inc_gst';
COMMENT ON COLUMN public.invoices.due_date IS 'DEPRECATED: use balance_due_date (installation date) / deposit_due_date';
COMMENT ON COLUMN public.invoices.amount_paid IS 'DEPRECATED: use total_paid';
COMMENT ON COLUMN public.invoices.paid_at IS 'DEPRECATED: use deposit_paid_at / balance_paid_at';

-- Native Xero "Request Deposit" is raised manually in Xero; admins record it here. Never unlocks scheduling.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_request_raised_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_request_raised_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_request_amount numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_request_pct numeric;

CREATE OR REPLACE FUNCTION public.invoice_deposit_cleared(_inv uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select exists (select 1 from public.invoices i where i.id = _inv and public.can_access_job(i.job_id)
    and (i.deposit_paid_at is not null or exists (select 1 from public.payment_overrides o where o.invoice_id = i.id and o.gate = 'deposit')))
$$;

CREATE OR REPLACE FUNCTION public.job_deposit_cleared(_job uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select coalesce((select public.invoice_deposit_cleared(i.id) from public.invoices i
    where i.job_id = _job and i.kind = 'installation' order by i.created_at desc limit 1), false)
  and public.can_access_job(_job)
$$;

DROP VIEW IF EXISTS public.invoice_payment_state;
DROP VIEW IF EXISTS public.job_overview;
DROP VIEW IF EXISTS public.invoice_status;

CREATE VIEW public.invoice_status WITH (security_invoker = true) AS
 SELECT id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct, deposit_amount,
    deposit_due_date, deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date, balance_paid_at, total_paid, created_at,
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
   FROM invoices i;

CREATE VIEW public.invoice_payment_state WITH (security_invoker = true) AS
 SELECT id, job_id, quote_id, kind, status, xero_contact_id, xero_invoice_id, xero_invoice_number, xero_reference, xero_online_url,
    total_inc_gst, deposit_pct, deposit_amount, deposit_due_date, deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date,
    total_paid, last_synced_at, last_sync_error, created_at, updated_at,
    ((deposit_paid_at IS NOT NULL) OR (EXISTS (SELECT 1 FROM payment_overrides o WHERE o.invoice_id = i.id AND o.gate = 'deposit'))) AS deposit_cleared,
    (SELECT s.effective_status FROM invoice_status s WHERE s.id = i.id) AS effective_status
   FROM invoices i;

CREATE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    concat_ws(', '::text, pr.address_line, pr.suburb, ((pr.state || ' '::text) || COALESCE(pr.postcode, ''::text))) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name, ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    (SELECT (p.effective_status)::text FROM invoice_status p WHERE p.job_id = j.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
    job_authority_status(j.id) AS authority_status,
    job_authority_expires_at(j.id) AS authority_expires_at,
    job_deposit_cleared(j.id) AS deposit_cleared,
    j.channel, j.commercial_model, j.originating_installer_user_id,
    ob.name AS originating_business_name
   FROM jobs j
     JOIN properties pr ON pr.id = j.property_id
     JOIN owners o ON o.id = j.owner_id
     LEFT JOIN job_assignments ea ON ea.job_id = j.id AND ea.active AND ea.role = 'electrician'::assignment_role
     LEFT JOIN profiles ep ON ep.id = ea.user_id
     LEFT JOIN job_assignments ia ON ia.job_id = j.id AND ia.active AND ia.role = 'installer'::assignment_role
     LEFT JOIN profiles ip ON ip.id = ia.user_id
     LEFT JOIN job_piesa_deadlines d ON d.job_id = j.id
     LEFT JOIN businesses ob ON ob.id = j.originating_installer_business_id;

GRANT SELECT ON public.invoice_status, public.invoice_payment_state, public.job_overview TO anon, authenticated;
GRANT ALL ON public.invoice_status, public.invoice_payment_state, public.job_overview TO service_role;