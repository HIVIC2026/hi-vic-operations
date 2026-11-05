-- Still-to-finish list: work that failed part-way and must be retried or handed to the office.
-- Service-role only. Pending: prove on PGlite, apply live only when Jo says yes.
CREATE TABLE public.recovery_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('veec_final_copy','veec_copy_email','stripe_payment_followup','stripe_refund_waiting','spot_saved_email')),
  work_key text NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','needs_office')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  UNIQUE (kind, work_key)
);
CREATE INDEX recovery_work_due_idx ON public.recovery_work (next_attempt_at) WHERE status = 'open';

ALTER TABLE public.recovery_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recovery_work FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.recovery_work TO service_role;
CREATE POLICY recovery_work_service ON public.recovery_work FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Leases due items by pushing next_attempt_at forward; an item the worker never finishes becomes due again after the lease.
CREATE FUNCTION public.claim_recovery_work(p_limit int, p_lease_seconds int)
RETURNS SETOF public.recovery_work
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public AS $$
  WITH due AS (
    SELECT id FROM public.recovery_work
    WHERE status = 'open' AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.recovery_work r
  SET next_attempt_at = now() + make_interval(secs => p_lease_seconds)
  FROM due WHERE r.id = due.id
  RETURNING r.*
$$;
REVOKE ALL ON FUNCTION public.claim_recovery_work(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recovery_work(int, int) TO service_role;
