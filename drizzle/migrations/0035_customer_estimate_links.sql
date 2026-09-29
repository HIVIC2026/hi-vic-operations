CREATE TABLE public.customer_estimate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'step3_estimate' CHECK (purpose = 'step3_estimate'),
  token text NOT NULL UNIQUE CHECK (length(token) >= 43),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  current_estimate_id uuid REFERENCES public.indicative_estimates(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX customer_estimate_links_one_active ON public.customer_estimate_links(job_id, purpose) WHERE status = 'active';
REVOKE ALL ON public.customer_estimate_links FROM anon, authenticated, public;
GRANT ALL ON public.customer_estimate_links TO service_role;
ALTER TABLE public.customer_estimate_links ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.customer_estimate_links IS 'Service-role only secure no-login Step 3 estimate links. No anon/authenticated policies by design.';