ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'preliminary_estimate_ready';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'ready_check_awaiting_acceptance';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'ready_check_awaiting_payment';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'ready_check_ready_to_schedule';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'ready_check_scheduled';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'ready_check_complete';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'measured_estimate_ready';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'measured_quote_accepted';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'piesa_and_install_window_pending';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'piesa_scheduled';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'piesa_complete';
ALTER TYPE public.job_stage ADD VALUE IF NOT EXISTS 'electrical_variation_pending';

-- Versioned agreed REC customer rate cards (no rates seeded; production stays unconfigured)
CREATE TABLE public.rec_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  active boolean NOT NULL DEFAULT false,
  test_only boolean NOT NULL DEFAULT false,
  provider_business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_business_id, version)
);
GRANT SELECT ON public.rec_rate_cards TO authenticated;
GRANT ALL ON public.rec_rate_cards TO service_role;
ALTER TABLE public.rec_rate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read REC rate cards" ON public.rec_rate_cards FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE public.rec_rate_card_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id uuid NOT NULL REFERENCES public.rec_rate_cards(id) ON DELETE RESTRICT,
  code text NOT NULL,
  description text NOT NULL,
  rule_kind text NOT NULL CHECK (rule_kind IN ('QUANTITY_RATE','FIXED_ALLOWANCE','CONSERVATIVE_ALLOWANCE','UNPRICEABLE_FLAG')),
  unit text NOT NULL CHECK (unit IN ('each','fixed')),
  rate_inc_gst numeric(12,2) CHECK (rate_inc_gst IS NULL OR rate_inc_gst >= 0),
  internal_cost_ex_gst numeric(12,2) CHECK (internal_cost_ex_gst IS NULL OR internal_cost_ex_gst >= 0),
  trigger_key text NOT NULL,
  trigger_value jsonb,
  quantity_source text,
  conservative_quantity integer CHECK (conservative_quantity IS NULL OR conservative_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_card_id, code),
  CHECK ((rule_kind = 'UNPRICEABLE_FLAG') = (rate_inc_gst IS NULL))
);
GRANT SELECT ON public.rec_rate_card_items TO authenticated;
GRANT ALL ON public.rec_rate_card_items TO service_role;
ALTER TABLE public.rec_rate_card_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read REC rate card items" ON public.rec_rate_card_items FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER rec_rate_card_items_immutable BEFORE UPDATE OR DELETE ON public.rec_rate_card_items FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TABLE public.rec_rate_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id uuid NOT NULL REFERENCES public.rec_rate_cards(id) ON DELETE RESTRICT,
  actor_id uuid,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_rate_card_events TO authenticated;
GRANT ALL ON public.rec_rate_card_events TO service_role;
ALTER TABLE public.rec_rate_card_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read REC rate card audit" ON public.rec_rate_card_events FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER rec_rate_card_events_immutable BEFORE UPDATE OR DELETE ON public.rec_rate_card_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

-- Ready Check (insulation installer visit), Mitti-ready key/value observations
CREATE TABLE public.ready_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','superseded')),
  installer_user_id uuid,
  installer_business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT,
  attended_at timestamptz,
  external_mitti_id text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);
GRANT SELECT ON public.ready_checks TO authenticated;
GRANT ALL ON public.ready_checks TO service_role;
ALTER TABLE public.ready_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants read ready checks" ON public.ready_checks FOR SELECT TO authenticated USING (public.can_access_job(job_id));
COMMENT ON TABLE public.ready_checks IS 'Home Insulation Ready Check by an insulation installer. Not a PIESA; never records electrical compliance.';

CREATE TABLE public.ready_check_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ready_check_id uuid NOT NULL REFERENCES public.ready_checks(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  field_key text NOT NULL CHECK (field_key ~ '^(attendance|measure|insulation|removal|access|elec)\.[a-z0-9_]+$' AND field_key !~* '(piesa|pass|fail|complian|adequa|safe_to|certif)'),
  value jsonb,
  evidence_document_ids uuid[] NOT NULL DEFAULT '{}',
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ready_check_id, field_key)
);
GRANT SELECT ON public.ready_check_observations TO authenticated;
GRANT ALL ON public.ready_check_observations TO service_role;
ALTER TABLE public.ready_check_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants read ready check observations" ON public.ready_check_observations FOR SELECT TO authenticated USING (public.can_access_job(job_id));
COMMENT ON TABLE public.ready_check_observations IS 'Objective installer observations keyed by stable internal field keys (Mitti IDs mapped later). No PIESA/compliance keys allowed.';

CREATE TABLE public.electrical_allowance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  ready_check_id uuid NOT NULL REFERENCES public.ready_checks(id) ON DELETE RESTRICT,
  ready_check_version integer NOT NULL,
  rate_card_id uuid REFERENCES public.rec_rate_cards(id) ON DELETE RESTRICT,
  rate_card_version integer NOT NULL,
  preliminary_only boolean NOT NULL DEFAULT true CHECK (preliminary_only),
  allowance_total_inc_gst numeric(12,2) NOT NULL CHECK (allowance_total_inc_gst >= 0),
  lines jsonb NOT NULL,
  unpriceable jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ready_check_id, ready_check_version, rate_card_id)
);
GRANT SELECT ON public.electrical_allowance_snapshots TO authenticated;
GRANT ALL ON public.electrical_allowance_snapshots TO service_role;
ALTER TABLE public.electrical_allowance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read allowance snapshots" ON public.electrical_allowance_snapshots FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER electrical_allowance_snapshots_immutable BEFORE UPDATE OR DELETE ON public.electrical_allowance_snapshots FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TABLE public.piesa_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  allowance_snapshot_id uuid NOT NULL REFERENCES public.electrical_allowance_snapshots(id) ON DELETE RESTRICT,
  actual_items jsonb NOT NULL,
  priced_lines jsonb NOT NULL,
  unmatched_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  actual_total_inc_gst numeric(12,2) NOT NULL,
  preliminary_total_inc_gst numeric(12,2) NOT NULL,
  variance_inc_gst numeric(12,2) NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('same','lower','higher')),
  requires_customer_approval boolean NOT NULL,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.piesa_reconciliations TO authenticated;
GRANT ALL ON public.piesa_reconciliations TO service_role;
ALTER TABLE public.piesa_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read PIESA reconciliations" ON public.piesa_reconciliations FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER piesa_reconciliations_immutable BEFORE UPDATE OR DELETE ON public.piesa_reconciliations FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TABLE public.job_install_windows (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  planned_piesa_date date,
  planned_install_date date,
  piesa_completed_at timestamptz,
  buffer_min_days integer NOT NULL DEFAULT 7,
  buffer_max_days integer NOT NULL DEFAULT 14,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_install_windows TO authenticated;
GRANT ALL ON public.job_install_windows TO service_role;
ALTER TABLE public.job_install_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants read install windows" ON public.job_install_windows FOR SELECT TO authenticated USING (public.can_access_job(job_id));

-- $99 Ready Check acceptance/payment (test mode only). Supersedes the $349 pre-assessment model.
CREATE TABLE public.ready_check_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.indicative_estimates(id) ON DELETE RESTRICT,
  estimate_input_signature text NOT NULL,
  estimate_settings_version integer NOT NULL,
  cost_after_discount_inc_gst numeric(12,2) NOT NULL CHECK (cost_after_discount_inc_gst >= 0),
  estimated_discount_inc_gst numeric(12,2) NOT NULL CHECK (estimated_discount_inc_gst >= 0),
  ready_check_amount_inc_gst numeric(12,2) NOT NULL CHECK (ready_check_amount_inc_gst = 99.00),
  estimated_remaining_balance_inc_gst numeric(12,2) NOT NULL CHECK (estimated_remaining_balance_inc_gst >= 0),
  copy_version text NOT NULL,
  snapshot jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_ip inet,
  accepted_user_agent text,
  UNIQUE (job_id, estimate_id)
);
GRANT ALL ON public.ready_check_acceptances TO service_role;
ALTER TABLE public.ready_check_acceptances ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ready_check_acceptances_immutable BEFORE UPDATE OR DELETE ON public.ready_check_acceptances FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TABLE public.ready_check_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acceptance_id uuid NOT NULL UNIQUE REFERENCES public.ready_check_acceptances(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'home_insulation_ready_check' CHECK (purpose = 'home_insulation_ready_check'),
  amount_inc_gst numeric(12,2) NOT NULL CHECK (amount_inc_gst = 99.00),
  mode text NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','failed','paid')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failed_at timestamptz,
  paid_at timestamptz,
  credit_applied_to_quote_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
GRANT ALL ON public.ready_check_payments TO service_role;
ALTER TABLE public.ready_check_payments ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX ready_check_payments_one_paid_per_job ON public.ready_check_payments(job_id) WHERE status = 'paid';
COMMENT ON TABLE public.ready_check_payments IS 'Test-mode $99 Ready Check payment; credited once toward the project. Never an installation invoice, Xero record or 50% deposit.';

CREATE TABLE public.ready_check_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.ready_check_payments(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  outcome text NOT NULL CHECK (outcome IN ('failed','success')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, idempotency_key)
);
GRANT ALL ON public.ready_check_payment_attempts TO service_role;
ALTER TABLE public.ready_check_payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ready_check_payment_attempts_immutable BEFORE UPDATE OR DELETE ON public.ready_check_payment_attempts FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE OR REPLACE FUNCTION public.guard_ready_check_payment_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.acceptance_id <> OLD.acceptance_id OR NEW.job_id <> OLD.job_id
     OR NEW.purpose <> OLD.purpose OR NEW.amount_inc_gst <> OLD.amount_inc_gst
     OR NEW.mode <> OLD.mode OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ready check payment identity and amount are immutable';
  END IF;
  IF OLD.status = 'paid' AND (NEW.status <> OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'paid ready check payment is immutable';
  END IF;
  IF OLD.credit_applied_to_quote_id IS NOT NULL AND NEW.credit_applied_to_quote_id IS DISTINCT FROM OLD.credit_applied_to_quote_id THEN
    RAISE EXCEPTION 'ready check credit can be applied only once';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN RAISE EXCEPTION 'attempt count cannot decrease'; END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER ready_check_payments_lifecycle BEFORE UPDATE ON public.ready_check_payments FOR EACH ROW EXECUTE FUNCTION public.guard_ready_check_payment_lifecycle();
CREATE TRIGGER ready_check_payments_no_delete BEFORE DELETE ON public.ready_check_payments FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE OR REPLACE FUNCTION public.accept_ready_check_test(
  _job_id uuid, _estimate_id uuid, _estimate_input_signature text, _estimate_settings_version integer,
  _cost_after_discount numeric, _estimated_discount numeric, _estimated_remaining numeric,
  _copy_version text, _snapshot jsonb, _accepted_ip inet DEFAULT NULL, _accepted_user_agent text DEFAULT NULL)
RETURNS TABLE(acceptance_id uuid, payment_id uuid, payment_status text, accepted_at timestamptz, paid_at timestamptz, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.ready_check_acceptances; p public.ready_check_payments; inserted boolean := false;
BEGIN
  INSERT INTO public.ready_check_acceptances (job_id, estimate_id, estimate_input_signature, estimate_settings_version,
    cost_after_discount_inc_gst, estimated_discount_inc_gst, ready_check_amount_inc_gst, estimated_remaining_balance_inc_gst,
    copy_version, snapshot, accepted_ip, accepted_user_agent)
  VALUES (_job_id, _estimate_id, _estimate_input_signature, _estimate_settings_version, _cost_after_discount,
    _estimated_discount, 99.00, _estimated_remaining, _copy_version, _snapshot, _accepted_ip, _accepted_user_agent)
  ON CONFLICT (job_id, estimate_id) DO NOTHING RETURNING * INTO a;
  IF a.id IS NULL THEN
    SELECT * INTO a FROM public.ready_check_acceptances WHERE job_id = _job_id AND estimate_id = _estimate_id;
  ELSE inserted := true; END IF;
  INSERT INTO public.ready_check_payments (acceptance_id, job_id, amount_inc_gst) VALUES (a.id, _job_id, 99.00)
  ON CONFLICT (acceptance_id) DO NOTHING;
  SELECT * INTO p FROM public.ready_check_payments WHERE ready_check_payments.acceptance_id = a.id;
  IF inserted THEN
    INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
    VALUES (_job_id, NULL, 'ready_check_accepted', 'Customer accepted the Home Insulation Ready Check',
      jsonb_build_object('audit_key', 'ready_check_accepted:' || a.id::text, 'acceptance_id', a.id, 'estimate_id', _estimate_id, 'amount_inc_gst', 99.00), true);
    UPDATE public.jobs SET last_activity_at = now() WHERE id = _job_id;
  END IF;
  RETURN QUERY SELECT a.id, p.id, p.status, a.accepted_at, p.paid_at, inserted;
END $$;
REVOKE ALL ON FUNCTION public.accept_ready_check_test(uuid,uuid,text,integer,numeric,numeric,numeric,text,jsonb,inet,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_ready_check_test(uuid,uuid,text,integer,numeric,numeric,numeric,text,jsonb,inet,text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_ready_check_test_payment(_payment_id uuid, _idempotency_key text, _outcome text)
RETURNS TABLE(payment_status text, paid_at timestamptz, changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.ready_check_payments; n integer; next_status text; now_at timestamptz := now();
BEGIN
  IF _outcome NOT IN ('failure','success') THEN RAISE EXCEPTION 'invalid test payment outcome'; END IF;
  SELECT * INTO p FROM public.ready_check_payments WHERE id = _payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'ready check payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN QUERY SELECT p.status, p.paid_at, false; RETURN; END IF;
  INSERT INTO public.ready_check_payment_attempts (payment_id, job_id, idempotency_key, outcome)
  VALUES (p.id, p.job_id, _idempotency_key, CASE WHEN _outcome = 'success' THEN 'success' ELSE 'failed' END)
  ON CONFLICT (payment_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN QUERY SELECT p.status, p.paid_at, false; RETURN; END IF;
  next_status := CASE WHEN _outcome = 'success' THEN 'paid' ELSE 'failed' END;
  UPDATE public.ready_check_payments SET status = next_status, attempt_count = attempt_count + 1,
    failed_at = CASE WHEN next_status = 'failed' THEN now_at ELSE failed_at END,
    paid_at = CASE WHEN next_status = 'paid' THEN now_at ELSE ready_check_payments.paid_at END
  WHERE id = p.id RETURNING * INTO p;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
  VALUES (p.job_id, NULL,
    CASE WHEN next_status = 'paid' THEN 'ready_check_payment_received' ELSE 'ready_check_payment_failed' END,
    CASE WHEN next_status = 'paid' THEN '$99 Ready Check test payment received' ELSE '$99 Ready Check test payment failed' END,
    jsonb_build_object('audit_key', 'ready_check_payment:' || p.id::text || ':' || _idempotency_key, 'payment_id', p.id, 'amount_inc_gst', 99.00, 'mode', 'test'), true);
  RETURN QUERY SELECT p.status, p.paid_at, true;
END $$;
REVOKE ALL ON FUNCTION public.apply_ready_check_test_payment(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ready_check_test_payment(uuid,text,text) TO service_role;

-- Retire the obsolete $349-first flow: no longer callable.
REVOKE EXECUTE ON FUNCTION public.accept_pre_assessment_test(uuid,uuid,text,integer,numeric,numeric,numeric,text,jsonb,inet,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.apply_pre_assessment_test_payment(uuid,text,text) FROM service_role;
COMMENT ON TABLE public.assessment_acceptances IS 'DEPRECATED: $349 Measure + PIESA first-payment flow superseded by ready_check_acceptances.';
COMMENT ON TABLE public.assessment_payments IS 'DEPRECATED: superseded by ready_check_payments ($99 Ready Check).';
COMMENT ON TABLE public.assessment_payment_attempts IS 'DEPRECATED: superseded by ready_check_payment_attempts.';