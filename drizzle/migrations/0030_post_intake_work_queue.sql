-- Durable post-intake queue: Step 1 intake is acknowledged after enqueue; a worker runs initial
-- Property Intelligence then ONE authoritative Gate 1 categorisation. Admin/service only.
CREATE TABLE public.post_intake_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  work_type text NOT NULL DEFAULT 'initial_gate1' CHECK (work_type IN ('initial_gate1')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','retry','complete','failed')),
  facts_version text NOT NULL,
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_id, work_type)
);
CREATE INDEX post_intake_work_due_idx ON public.post_intake_work (status, available_at);

GRANT SELECT ON public.post_intake_work TO authenticated;
GRANT ALL ON public.post_intake_work TO service_role;
ALTER TABLE public.post_intake_work ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read post-intake work" ON public.post_intake_work FOR SELECT TO authenticated USING (public.is_admin());

CREATE TRIGGER post_intake_work_touch BEFORE UPDATE ON public.post_intake_work FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Atomic claim: due queued/retry items plus processing items whose lease expired. SKIP LOCKED => no double processing.
CREATE OR REPLACE FUNCTION public.claim_post_intake_work(_limit integer, _lease_seconds integer, _job uuid DEFAULT NULL)
RETURNS SETOF public.post_intake_work
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.post_intake_work w
     SET status = 'processing', attempts = w.attempts + 1, locked_at = now(),
         lease_expires_at = now() + make_interval(secs => _lease_seconds)
   WHERE w.id IN (
     SELECT id FROM public.post_intake_work
      WHERE (_job IS NULL OR job_id = _job)
        AND ((status IN ('queued','retry') AND available_at <= now())
          OR (status = 'processing' AND lease_expires_at < now()))
      ORDER BY available_at
      LIMIT greatest(1, least(_limit, 50))
      FOR UPDATE SKIP LOCKED)
  RETURNING w.*;
$$;
REVOKE ALL ON FUNCTION public.claim_post_intake_work(integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_intake_work(integer, integer, uuid) TO service_role;