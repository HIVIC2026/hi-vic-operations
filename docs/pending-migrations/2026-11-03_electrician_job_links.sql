-- PENDING ONLY. Jo applies this. Part 2 (Jo 3 Nov 2026): the electrician's no-login link for an installer's own job
-- (/e/<token>). Only the SHA-256 of the token is stored. Service role only: no browser reads or writes.
-- Until this is applied the code fails closed: no link is made, the electrician's text is held, and the installer
-- office email still goes (it links to the job page, not to this link).
-- IDEMPOTENT (G6 go-live, 4 Nov 2026): the generated types already list this table, so the live database MAY have it
-- (main's Part 2, #130). Safe to run over an existing copy. Undo: 2026-11-03_electrician_job_links.undo.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.electrician_job_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  electrician_business_id uuid NOT NULL REFERENCES public.businesses(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text
);
CREATE INDEX IF NOT EXISTS electrician_job_links_job_idx ON public.electrician_job_links (job_id) WHERE revoked_at IS NULL;

ALTER TABLE public.electrician_job_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.electrician_job_links FROM anon, authenticated;
GRANT ALL ON public.electrician_job_links TO service_role;

COMMIT;
