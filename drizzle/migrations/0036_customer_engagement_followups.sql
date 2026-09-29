-- Step 3 customer engagement + follow-up layer. Service-role writes only; admins may read.
CREATE TABLE public.customer_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  estimate_link_id uuid NULL REFERENCES public.customer_estimate_links(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('email_sent','email_delivered','email_opened','email_clicked','estimate_viewed','calculator_used','booking_started','booking_completed','followup_queued','followup_sent','followup_suppressed','email_bounced','email_failed')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'portal',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_engagement_events_dedupe ON public.customer_engagement_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX customer_engagement_events_job ON public.customer_engagement_events (job_id, occurred_at DESC);
GRANT SELECT ON public.customer_engagement_events TO authenticated;
GRANT ALL ON public.customer_engagement_events TO service_role;
ALTER TABLE public.customer_engagement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read engagement events" ON public.customer_engagement_events FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE public.customer_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  estimate_link_id uuid NULL REFERENCES public.customer_estimate_links(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed')),
  provider text NULL,
  provider_message_id text NULL,
  communication_id uuid NULL REFERENCES public.job_communications(id),
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL
);
GRANT ALL ON public.customer_email_sends TO service_role;
ALTER TABLE public.customer_email_sends ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.engagement_tracking_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('click','open')),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  estimate_link_id uuid NULL REFERENCES public.customer_estimate_links(id) ON DELETE SET NULL,
  email_send_id uuid NULL REFERENCES public.customer_email_sends(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT ALL ON public.engagement_tracking_tokens TO service_role;
ALTER TABLE public.engagement_tracking_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.customer_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  estimate_link_id uuid NULL REFERENCES public.customer_estimate_links(id) ON DELETE SET NULL,
  slot text NOT NULL CHECK (slot IN ('3d','7d')),
  kind text NOT NULL CHECK (kind IN ('estimate_unopened_3d','estimate_engaged_no_booking_3d','estimate_second_reminder_7d')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','suppressed','failed')),
  due_at timestamptz NOT NULL,
  reason text NULL,
  suppression_reason text NULL,
  blocked_reason text NULL,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz NULL,
  last_error text NULL,
  communication_id uuid NULL REFERENCES public.job_communications(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  UNIQUE (job_id, slot),
  UNIQUE (job_id, kind)
);
CREATE INDEX customer_followups_due ON public.customer_followups (status, due_at);
GRANT SELECT ON public.customer_followups TO authenticated;
GRANT ALL ON public.customer_followups TO service_role;
ALTER TABLE public.customer_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read followups" ON public.customer_followups FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER customer_followups_touch BEFORE UPDATE ON public.customer_followups FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Safe claim: due pending rows, or queued rows whose lease expired (crash recovery).
CREATE OR REPLACE FUNCTION public.claim_customer_followups(_limit integer, _lease_seconds integer)
RETURNS SETOF public.customer_followups LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.customer_followups f SET status = 'queued', lease_until = now() + make_interval(secs => _lease_seconds), attempts = f.attempts + 1
  WHERE f.id IN (
    SELECT id FROM public.customer_followups
    WHERE due_at <= now() AND (status = 'pending' OR (status = 'queued' AND lease_until < now()))
    ORDER BY due_at LIMIT _limit FOR UPDATE SKIP LOCKED)
  RETURNING f.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_customer_followups(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_customer_followups(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.customer_followups_tick(_url text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE n text := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO public.cron_nonces (nonce, purpose) VALUES (n, 'customer_followups');
  RETURN net.http_post(url := _url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-hivic-cron-nonce', n), body := '{}'::jsonb, timeout_milliseconds := 55000);
END $$;
REVOKE ALL ON FUNCTION public.customer_followups_tick(text) FROM PUBLIC, anon, authenticated;