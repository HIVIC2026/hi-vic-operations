-- No-login owner signing: 6-digit SMS/email codes and short owner sessions for a secure link. Hashes only.
CREATE TABLE IF NOT EXISTS public.owner_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  destination_masked text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  session_hash text UNIQUE,
  session_expires_at timestamptz,
  owner_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_link_codes_job ON public.owner_link_codes (job_id, created_at DESC);
GRANT ALL ON public.owner_link_codes TO service_role;
ALTER TABLE public.owner_link_codes ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.owner_link_codes IS 'Server-only: one-time owner verification codes (hashed) and short signing sessions for the no-login owner link.';
