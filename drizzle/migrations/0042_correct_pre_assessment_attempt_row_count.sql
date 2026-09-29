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
  inserted_attempt_count integer := 0;
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
  GET DIAGNOSTICS inserted_attempt_count = ROW_COUNT;
  IF inserted_attempt_count = 0 THEN RETURN QUERY SELECT p.status, p.paid_at, false; RETURN; END IF;

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