-- Separate invoices (batch 3b): a job can carry a fixes invoice and repeat safety check invoices next to the install one.
-- APPLIED to the live database 29 Oct 2026 (Jo said yes), with NOTIFY pgrst reload. Proven first on a practice database (tests/batch3b-invoices-db.test.ts). Re-runnable.
--  * kind gains 'repeat_safety_check'; fixes invoices keep kind 'rectification' and still point at their fixes quote.
--  * A repeat safety check invoice has no quote: quote_id is empty and repeat_key (e.g. 'reopen:<iso>') is set.
--  * One invoice per quote stays (invoices_quote_id_key). One repeat invoice per job and repeat_key.
--  * payment_status gains 'voided': an old fixes invoice voided/deleted in Xero after a newer fixes quote replaced it.
--    invoice_status passes it through (like invoice_not_created / xero_sync_error), so it is never shown as owing.
--  * job_overview.payment_status follows the installation invoice only (not a newer fixes / repeat invoice).
--    Same columns; CREATE OR REPLACE keeps the existing grants.
-- The checks compare kind::text so this file also works when the whole file runs as one transaction
-- (a brand-new enum value can't be used inside the transaction that adds it); invoice_status compares status::text for the same reason.

ALTER TYPE public.quote_kind ADD VALUE IF NOT EXISTS 'repeat_safety_check';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'voided';

ALTER TABLE public.invoices ALTER COLUMN quote_id DROP NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS repeat_key text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_quote_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_repeat_quote_check
  CHECK ((kind::text = 'repeat_safety_check') = (quote_id IS NULL));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_key_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_repeat_key_check
  CHECK ((kind::text = 'repeat_safety_check') = (repeat_key IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_repeat_key_idx ON public.invoices (job_id, repeat_key) WHERE repeat_key IS NOT NULL;

-- invoice_status: latest definition (0079) with 'voided' passed through.
CREATE OR REPLACE VIEW public.invoice_status WITH (security_invoker = true) AS
SELECT id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_pct, deposit_amount, deposit_due_date,
  deposit_paid_amount, deposit_paid_at, balance_amount, balance_due_date, balance_paid_at, total_paid, created_at,
  public.invoice_deposit_cleared(id) AS deposit_cleared,
  CASE
    WHEN status::text = ANY (ARRAY['invoice_not_created', 'xero_sync_error', 'voided']) THEN status
    WHEN total_paid >= total_inc_gst THEN 'fully_paid'::payment_status
    WHEN NOT public.invoice_deposit_cleared(id) AND deposit_due_date < (CURRENT_DATE - 7) THEN 'overdue'::payment_status
    WHEN NOT public.invoice_deposit_cleared(id) THEN 'deposit_due'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date < CURRENT_DATE THEN 'overdue'::payment_status
    WHEN balance_due_date IS NOT NULL AND balance_due_date <= CURRENT_DATE THEN 'balance_due'::payment_status
    ELSE 'deposit_paid'::payment_status
  END AS effective_status
FROM public.invoices i;

-- job_overview: latest definition (0055) with the payment status taken from the installation invoice only.
CREATE OR REPLACE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    public.format_property_address(pr.address_line, pr.suburb, pr.state, pr.postcode) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name,
    ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    ( SELECT (p.effective_status)::text FROM invoice_status p WHERE p.job_id = j.id AND p.kind = 'installation'::quote_kind ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
    job_authority_status(j.id) AS authority_status,
    job_authority_expires_at(j.id) AS authority_expires_at,
    job_deposit_cleared(j.id) AS deposit_cleared,
    j.channel, j.commercial_model, j.originating_installer_user_id,
    ob.name AS originating_business_name,
    j.source,
    j.eligibility_review_required,
    j.eligibility_flags
   FROM jobs j
     JOIN properties pr ON pr.id = j.property_id
     JOIN owners o ON o.id = j.owner_id
     LEFT JOIN job_assignments ea ON ea.job_id = j.id AND ea.active AND ea.role = 'electrician'::assignment_role
     LEFT JOIN profiles ep ON ep.id = ea.user_id
     LEFT JOIN job_assignments ia ON ia.job_id = j.id AND ia.active AND ia.role = 'installer'::assignment_role
     LEFT JOIN profiles ip ON ip.id = ia.user_id
     LEFT JOIN job_piesa_deadlines d ON d.job_id = j.id
     LEFT JOIN businesses ob ON ob.id = j.originating_installer_business_id;
