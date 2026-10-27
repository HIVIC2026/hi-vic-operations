CREATE TABLE IF NOT EXISTS public.qa_owner_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  code_id uuid NOT NULL UNIQUE,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.qa_owner_codes FROM anon, authenticated;
GRANT ALL ON public.qa_owner_codes TO service_role;
ALTER TABLE public.qa_owner_codes ENABLE ROW LEVEL SECURITY;