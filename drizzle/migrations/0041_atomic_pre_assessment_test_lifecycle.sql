CREATE OR REPLACE FUNCTION public.accept_pre_assessment_test(
  _job_id uuid,
  _estimate_id uuid,
  _estimate_input_signature text,
  _estimate_settings_version integer,
  _customer_total numeric,
  _estimated_discount numeric,
  _estimated_remaining numeric,
  _copy_version text,
  _snapshot jsonb,
  _accepted_ip inet DEFAULT NULL,
  _accepted_user_agent text DEFAULT NULL
)
RETURNS TABLE(acceptance_id uuid, payment_id uuid, payment_status text, accepted_at timestamptz, paid_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.assessment_acceptances;
  p public.assessment_payments;
  inserted boolean := false;
BEGIN
  INSERT INTO public.assessment_acceptances (
    job_id, estimate_id, estimate_input_signature, estimate_settings_version,
    customer_total_inc_gst, estimated_discount_inc_gst, assessment_amount_inc_gst,
    estimated_remaining_balance_inc_gst, copy_version, snapshot, accepted_ip, accepted_user_agent
  ) VALUES (
    _job_id, _estimate_id, _estimate_input_signature, _estimate_settings_version,
    _customer_total, _estimated_discount, 349.00, _estimated_remaining,
    _copy_version, _snapshot, _accepted_ip, _accepted_user_agent
  )
  ON CONFLICT (job_id, estimate_id) DO NOTHING
  RETURNING * INTO a;

  IF a.id IS NULL THEN
    SELECT * INTO a FROM public.assessment_acceptances
    WHERE job_id = _job_id AND estimate_id = _estimate_id;
  ELSE
    inserted := true;
  END IF;

  INSERT INTO public.assessment_payments (acceptance_id, job_id, amount_inc_gst)
  VALUES (a.id, _job_id, 349.00)
  ON CONFLICT (acceptance_id) DO NOTHING;

  SELECT * INTO p FROM public.assessment_payments WHERE acceptance_id = a.id;

  IF inserted THEN
    INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
    VALUES (_job_id, NULL, 'pre_assessment_accepted', 'Customer accepted the Measure + PIESA assessment',
      jsonb_build_object('audit_key', 'pre_assessment_accepted:' || a.id::text, 'acceptance_id', a.id, 'estimate_id', _estimate_id, 'amount_inc_gst', 349.00), true);
    UPDATE public.jobs SET last_activity_at = now() WHERE id = _job_id;
  END IF;

  RETURN QUERY SELECT a.id, p.id, p.status, a.accepted_at, p.paid_at, inserted;
END
$$;
REVOKE ALL ON FUNCTION public.accept_pre_assessment_test(uuid,uuid,text,integer,numeric,numeric,numeric,text,jsonb,inet,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_pre_assessment_test(uuid,uuid,text,integer,numeric,numeric,numeric,text,jsonb,inet,text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_pre_assessment_test_payment(
  _payment_id uuid,
  _idempotency_key text,
  _outcome text
)
RETURNS TABLE(payment_status text, paid_at timestamptz, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.assessment_payments;
  inserted_attempt boolean := false;
  next_status text;
  now_at timestamptz := now();
BEGIN
  IF _outcome NOT IN ('failed','success') THEN RAISE EXCEPTION 'invalid test payment outcome'; END IF;
  SELECT * INTO p FROM public.assessment_payments WHERE id = _payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'assessment payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN QUERY SELECT p.status, p.paid_at, false; RETURN; END IF;

  INSERT INTO public.assessment_payment_attempts (payment_id, job_id, idempotency_key, outcome)
  VALUES (p.id, p.job_id, _idempotency_key, CASE WHEN _outcome = 'success' THEN 'success' ELSE 'failed' END)
  ON CONFLICT (payment_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_attempt = ROW_COUNT;
  IF NOT inserted_attempt THEN RETURN QUERY SELECT p.status, p.paid_at, false; RETURN; END IF;

  next_status := CASE WHEN _outcome = 'success' THEN 'paid' ELSE 'failed' END;
  UPDATE public.assessment_payments
  SET status = next_status,
      attempt_count = attempt_count + 1,
      failed_at = CASE WHEN next_status = 'failed' THEN now_at ELSE failed_at END,
      paid_at = CASE WHEN next_status = 'paid' THEN now_at ELSE paid_at END
  WHERE id = p.id
  RETURNING * INTO p;

  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
  VALUES (p.job_id, NULL,
    CASE WHEN next_status = 'paid' THEN 'pre_assessment_payment_received' ELSE 'pre_assessment_payment_failed' END,
    CASE WHEN next_status = 'paid' THEN '$349 Measure + PIESA test payment received' ELSE '$349 Measure + PIESA test payment failed' END,
    jsonb_build_object('audit_key', 'pre_assessment_payment:' || p.id::text || ':' || _idempotency_key, 'payment_id', p.id, 'acceptance_id', p.acceptance_id, 'amount_inc_gst', 349.00, 'mode', 'test', 'idempotency_key', _idempotency_key), true);
  UPDATE public.jobs SET last_activity_at = now_at WHERE id = p.job_id;

  RETURN QUERY SELECT p.status, p.paid_at, true;
END
$$;
REVOKE ALL ON FUNCTION public.apply_pre_assessment_test_payment(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pre_assessment_test_payment(uuid,text,text) TO service_role;