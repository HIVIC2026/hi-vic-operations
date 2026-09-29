CREATE TABLE public.customer_email_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  token text NOT NULL UNIQUE,
  opted_out_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.customer_email_optouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_email_optouts TO service_role;
ALTER TABLE public.customer_email_optouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_email_sends DROP CONSTRAINT IF EXISTS customer_email_sends_status_check;
ALTER TABLE public.customer_email_sends ADD CONSTRAINT customer_email_sends_status_check CHECK (status IN ('sending','sent','failed','delivered_unrecorded'));

ALTER TABLE public.customer_delivery_settings ADD COLUMN IF NOT EXISTS jobs_created_after timestamptz NULL;