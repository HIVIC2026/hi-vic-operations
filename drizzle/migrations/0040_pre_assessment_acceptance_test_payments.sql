CREATE TABLE public.assessment_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.indicative_estimates(id) ON DELETE RESTRICT,
  estimate_input_signature text NOT NULL,
  estimate_settings_version integer NOT NULL,
  customer_total_inc_gst numeric(12,2) NOT NULL CHECK (customer_total_inc_gst >= 0),
  estimated_discount_inc_gst numeric(12,2) NOT NULL CHECK (estimated_discount_inc_gst >= 0),
  assessment_amount_inc_gst numeric(12,2) NOT NULL CHECK (assessment_amount_inc_gst = 349.00),
  estimated_remaining_balance_inc_gst numeric(12,2) NOT NULL CHECK (estimated_remaining_balance_inc_gst >= 0),
  copy_version text NOT NULL,
  snapshot jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_ip inet,
  accepted_user_agent text,
  UNIQUE (job_id, estimate_id)
);
GRANT ALL ON public.assessment_acceptances TO service_role;
ALTER TABLE public.assessment_acceptances ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.assessment_acceptances IS 'Immutable pre-assessment Measure + PIESA acceptance snapshots; separate from final installation quote acceptance.';

CREATE TABLE public.assessment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acceptance_id uuid NOT NULL UNIQUE REFERENCES public.assessment_acceptances(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'measure_piesa_pre_assessment' CHECK (purpose = 'measure_piesa_pre_assessment'),
  amount_inc_gst numeric(12,2) NOT NULL CHECK (amount_inc_gst = 349.00),
  mode text NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','failed','paid')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'paid' AND paid_at IS NOT NULL) OR status <> 'paid')
);
GRANT ALL ON public.assessment_payments TO service_role;
ALTER TABLE public.assessment_payments ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX assessment_payments_one_paid_per_job ON public.assessment_payments(job_id) WHERE status = 'paid';
COMMENT ON TABLE public.assessment_payments IS 'Test-mode-only pre-assessment $349 payment state; never an installation invoice or 50% deposit.';

CREATE TABLE public.assessment_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.assessment_payments(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  outcome text NOT NULL CHECK (outcome IN ('failed','success')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, idempotency_key)
);
GRANT ALL ON public.assessment_payment_attempts TO service_role;
ALTER TABLE public.assessment_payment_attempts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.assessment_payment_attempts IS 'Immutable test-payment attempts and callback replay keys for the pre-assessment payment.';

CREATE OR REPLACE FUNCTION public.guard_assessment_acceptance_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'pre-assessment acceptance records are permanent and immutable';
END
$$;

CREATE TRIGGER assessment_acceptances_immutable
BEFORE UPDATE OR DELETE ON public.assessment_acceptances
FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_acceptance_immutable();

CREATE OR REPLACE FUNCTION public.guard_assessment_payment_attempt_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'pre-assessment payment attempts are permanent and immutable';
END
$$;

CREATE TRIGGER assessment_payment_attempts_immutable
BEFORE UPDATE OR DELETE ON public.assessment_payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_payment_attempt_immutable();

CREATE OR REPLACE FUNCTION public.guard_assessment_payment_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.acceptance_id <> OLD.acceptance_id OR NEW.job_id <> OLD.job_id
     OR NEW.purpose <> OLD.purpose OR NEW.amount_inc_gst <> OLD.amount_inc_gst
     OR NEW.mode <> OLD.mode OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'pre-assessment payment identity and amount are immutable';
  END IF;
  IF OLD.status = 'paid' AND (NEW.status <> OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'paid pre-assessment payment is immutable';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'pre-assessment payment attempt count cannot decrease';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER assessment_payments_lifecycle
BEFORE UPDATE ON public.assessment_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_payment_lifecycle();

CREATE TRIGGER assessment_payments_no_delete
BEFORE DELETE ON public.assessment_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_acceptance_immutable();