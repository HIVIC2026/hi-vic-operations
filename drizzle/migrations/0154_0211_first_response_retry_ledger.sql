-- CANDIDATE ONLY: assign the migration sequence after the concurrent installer build. Not applied.
-- This is retry scheduling, never a new delivery permission. All sends still use the existing guarded router.
CREATE TABLE public.first_response_retries (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  claim_token uuid,
  lease_until timestamptz,
  last_outcome text CHECK (last_outcome IN ('held', 'sent')),
  last_route text,
  last_reason text,
  last_recorded_at timestamptz,
  CHECK ((claim_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX first_response_retries_due ON public.first_response_retries(next_attempt_at, job_id);
ALTER TABLE public.first_response_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_response_retries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.first_response_retries TO service_role;

-- One current scope for claim and immediate pre-route recheck. Filter before LIMIT, so excluded/active/invalid
-- entries cannot fill a 50-row look-ahead page. No initial Gate 1, release, stage or consent changes occur here.
CREATE FUNCTION public.first_response_retry_scope(p_activated_at timestamptz, p_now timestamptz)
RETURNS TABLE(job_id uuid, job_number text, created_at timestamptz, source text, channel text,
  business_unit text, office_bucket text, needs_first_response boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id, j.job_number::text, j.created_at, j.source::text, j.channel::text, j.business_unit::text,
    i.office_bucket, i.needs_first_response
  FROM public.office_enquiry_index i JOIN public.jobs j ON j.id = i.id
  WHERE isfinite(p_activated_at) AND isfinite(p_now)
    AND j.created_at >= greatest(p_activated_at, p_now - interval '14 days') AND j.created_at <= p_now
    AND i.source = 'base44' AND i.channel = 'hivic_sourced'
    AND j.source = 'base44' AND j.channel::text = 'hivic_sourced' AND j.business_unit = 'hivic'
    AND j.deleted_at IS NULL AND j.qa_archived_at IS NULL
    AND i.office_bucket = 'enquiry' AND i.needs_first_response IS TRUE
    AND j.stage::text IN ('new_enquiry', 'eligibility_review', 'preliminary_estimate_ready', 'on_hold',
      'ready_check_awaiting_acceptance', 'ready_check_awaiting_payment', 'ready_check_ready_to_schedule')
    AND j.job_number NOT IN ('HV-2566', 'HV-2648')
    AND NOT EXISTS (SELECT 1 FROM public.post_intake_work w WHERE w.job_id = j.id
      AND (w.status IN ('queued', 'processing', 'retry') OR
        (w.status = 'failed' AND w.reason = 'ENQUIRY_BACKLOG_MANUAL' AND w.facts_version = 'enquiry-backlog-manual')))
$$;

CREATE FUNCTION public.claim_first_response_retries(p_activated_at timestamptz, p_limit integer DEFAULT 5)
RETURNS TABLE(job_id uuid, job_number text, created_at timestamptz, source text, channel text,
  business_unit text, office_bucket text, needs_first_response boolean, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5 THEN RAISE EXCEPTION 'Retry limit must be between 1 and 5'; END IF;
  IF p_activated_at IS NULL OR NOT isfinite(p_activated_at) THEN RAISE EXCEPTION 'Invalid activation time'; END IF;
  RETURN QUERY
  WITH eligible AS MATERIALIZED (SELECT * FROM public.first_response_retry_scope(p_activated_at, v_now)),
  due AS (
    SELECT e.job_id FROM eligible e LEFT JOIN public.first_response_retries r ON r.job_id = e.job_id
    WHERE r.last_outcome IS DISTINCT FROM 'sent'
      AND (r.job_id IS NULL OR (r.next_attempt_at <= v_now AND (r.claim_token IS NULL OR r.lease_until <= v_now)))
    ORDER BY coalesce(r.next_attempt_at, e.created_at), e.created_at, e.job_id LIMIT p_limit
  ), claimed AS (
    INSERT INTO public.first_response_retries AS r
      (job_id, attempt_count, next_attempt_at, last_attempt_at, claim_token, lease_until)
    SELECT d.job_id, 1, v_now + interval '10 minutes', v_now, gen_random_uuid(), v_now + interval '10 minutes' FROM due d
    ON CONFLICT ON CONSTRAINT first_response_retries_pkey DO UPDATE SET
      attempt_count = r.attempt_count + 1, next_attempt_at = EXCLUDED.next_attempt_at,
      last_attempt_at = EXCLUDED.last_attempt_at, claim_token = EXCLUDED.claim_token, lease_until = EXCLUDED.lease_until
    WHERE r.last_outcome IS DISTINCT FROM 'sent' AND r.next_attempt_at <= v_now
      AND (r.claim_token IS NULL OR r.lease_until <= v_now)
    RETURNING r.job_id, r.claim_token
  )
  SELECT e.job_id, e.job_number, e.created_at, e.source, e.channel, e.business_unit,
    e.office_bucket, e.needs_first_response, c.claim_token FROM claimed c JOIN eligible e ON e.job_id = c.job_id
  ORDER BY e.created_at, e.job_id;
END;
$$;

CREATE FUNCTION public.start_first_response_retry(p_job_id uuid, p_claim_token uuid, p_activated_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_claim public.first_response_retries%ROWTYPE;
BEGIN
  IF p_activated_at IS NULL OR NOT isfinite(p_activated_at) THEN RAISE EXCEPTION 'Invalid activation time'; END IF;
  SELECT * INTO v_claim FROM public.first_response_retries r WHERE r.job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_claim.claim_token IS DISTINCT FROM p_claim_token OR v_claim.lease_until IS NULL
    OR v_claim.lease_until <= v_now THEN RAISE EXCEPTION 'First-response retry claim expired or was taken over'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.first_response_retry_scope(p_activated_at, v_now) s WHERE s.job_id = p_job_id) THEN RETURN false; END IF;
  UPDATE public.first_response_retries SET lease_until = v_now + interval '10 minutes',
    next_attempt_at = v_now + interval '10 minutes' WHERE job_id = p_job_id AND claim_token = p_claim_token;
  RETURN true;
END;
$$;

CREATE FUNCTION public.finish_first_response_retry(p_job_id uuid, p_claim_token uuid, p_outcome text, p_route text, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_claim public.first_response_retries%ROWTYPE; v_reason text; v_delay integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'held') OR p_route IS NULL
    OR p_route NOT IN ('offer_spot', 'request_insulation', 'ineligible', 'none') OR p_reason IS NULL
    THEN RAISE EXCEPTION 'Invalid first-response retry outcome'; END IF;
  v_reason := left(p_reason, 2000);
  SELECT * INTO v_claim FROM public.first_response_retries r WHERE r.job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_claim.claim_token IS DISTINCT FROM p_claim_token OR v_claim.lease_until IS NULL
    OR v_claim.lease_until <= v_now THEN RAISE EXCEPTION 'First-response retry claim expired or was taken over'; END IF;
  -- Changed held reasons are INTERNAL job events. Event failure aborts this entire transaction; it is never discarded.
  IF p_outcome = 'held' AND (v_claim.last_outcome IS DISTINCT FROM p_outcome
    OR v_claim.last_reason IS DISTINCT FROM v_reason OR v_claim.last_route IS DISTINCT FROM p_route) THEN
    INSERT INTO public.workflow_events(job_id, actor_id, event_type, summary, details, internal)
    VALUES (p_job_id, NULL, 'automatic_first_response_held',
      left('Automatic first response held: ' || v_reason, 300),
      jsonb_build_object('reason', v_reason, 'route', p_route, 'retry_attempt', v_claim.attempt_count), true);
  END IF;
  -- 2, 4, 8, 16, 32, then at most 60 minutes. Untried older jobs sort ahead of these future due times.
  v_delay := least(3600, 120 * power(2, least(greatest(v_claim.attempt_count - 1, 0), 5))::integer);
  UPDATE public.first_response_retries SET claim_token = NULL, lease_until = NULL,
    last_outcome = p_outcome, last_route = p_route, last_reason = v_reason, last_recorded_at = v_now,
    next_attempt_at = CASE WHEN p_outcome = 'sent' THEN v_now + interval '14 days'
      ELSE v_now + make_interval(secs => v_delay) END WHERE job_id = p_job_id AND claim_token = p_claim_token;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.first_response_retry_scope(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_first_response_retries(timestamptz,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_first_response_retry(uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_first_response_retry(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_response_retry_scope(timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_first_response_retries(timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_first_response_retry(uuid,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_first_response_retry(uuid,uuid,text,text,text) TO service_role;
