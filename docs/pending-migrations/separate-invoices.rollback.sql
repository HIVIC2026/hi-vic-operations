-- Rollback for separate-invoices.sql. Stops with an error if any repeat safety check invoice exists (they have no quote,
-- so the old rule can't hold); settle or remove those first. The enum values 'repeat_safety_check' and 'voided' stay (Postgres can't drop one) and are harmless.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices WHERE quote_id IS NULL OR repeat_key IS NOT NULL OR kind::text = 'repeat_safety_check') THEN
    RAISE EXCEPTION 'separate-invoices rollback: repeat safety check invoices exist; remove them first';
  END IF;
END $$;

-- Views back to their previous definitions (0079 invoice_status, 0055 job_overview). Same columns, grants kept.
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

CREATE OR REPLACE VIEW public.job_overview WITH (security_invoker = true) AS
 SELECT j.id, j.job_number, j.stage, j.next_action, j.eligibility_outcome, j.life_support, j.last_activity_at, j.created_at, j.hold_reason,
    pr.id AS property_id,
    public.format_property_address(pr.address_line, pr.suburb, pr.state, pr.postcode) AS property_address,
    o.id AS owner_id, o.full_name AS owner_name, o.phone AS owner_phone, o.email AS owner_email,
    ea.user_id AS electrician_id, ep.full_name AS electrician_name,
    ia.user_id AS installer_id, ip.full_name AS installer_name,
    d.piesa_date, d.install_deadline, d.days_remaining, d.urgency, d.piesa_expired,
    ( SELECT (p.effective_status)::text FROM invoice_status p WHERE p.job_id = j.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
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

-- A voided old fixes invoice goes back to its previous stored status (the 'voided' enum value itself stays, unused).
UPDATE public.invoices SET status = 'deposit_due' WHERE status::text = 'voided';

DROP INDEX IF EXISTS public.invoices_job_repeat_key_idx;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_key_check;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_quote_check;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS repeat_key;
ALTER TABLE public.invoices ALTER COLUMN quote_id SET NOT NULL;
