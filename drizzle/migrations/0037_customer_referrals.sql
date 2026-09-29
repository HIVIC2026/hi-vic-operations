CREATE TABLE public.customer_referral_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  external_enquiry_id text NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  click_count integer NOT NULL DEFAULT 0,
  referred_submission_count integer NOT NULL DEFAULT 0,
  CHECK (job_id IS NOT NULL OR external_enquiry_id IS NOT NULL)
);
CREATE UNIQUE INDEX customer_referral_tokens_one_active_job ON public.customer_referral_tokens (job_id) WHERE status = 'active' AND job_id IS NOT NULL;
CREATE UNIQUE INDEX customer_referral_tokens_one_active_ext ON public.customer_referral_tokens (external_enquiry_id) WHERE status = 'active' AND job_id IS NULL;
GRANT ALL ON public.customer_referral_tokens TO service_role;
ALTER TABLE public.customer_referral_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.customer_referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_token_id uuid NOT NULL REFERENCES public.customer_referral_tokens(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('referral_link_created','referral_clicked','referral_submission')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  referred_external_enquiry_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NULL
);
CREATE UNIQUE INDEX customer_referral_events_dedupe ON public.customer_referral_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX customer_referral_events_token ON public.customer_referral_events (referral_token_id, occurred_at DESC);
GRANT ALL ON public.customer_referral_events TO service_role;
ALTER TABLE public.customer_referral_events ENABLE ROW LEVEL SECURITY;

-- Atomic counter bump (service role only).
CREATE OR REPLACE FUNCTION public.bump_referral_counter(_id uuid, _field text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _field = 'click' THEN UPDATE public.customer_referral_tokens SET click_count = click_count + 1, last_used_at = now() WHERE id = _id;
  ELSIF _field = 'submission' THEN UPDATE public.customer_referral_tokens SET referred_submission_count = referred_submission_count + 1, last_used_at = now() WHERE id = _id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.bump_referral_counter(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_referral_counter(uuid, text) TO service_role;