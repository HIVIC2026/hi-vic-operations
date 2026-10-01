ALTER TABLE public.partner_workers
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_label text,
  ADD COLUMN IF NOT EXISTS worker_id uuid REFERENCES public.partner_workers(id) ON DELETE SET NULL;

CREATE TABLE public.worker_job_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.partner_workers(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id),
  last_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0
);
CREATE INDEX worker_job_links_job_idx ON public.worker_job_links(job_id);
CREATE UNIQUE INDEX worker_job_links_one_active ON public.worker_job_links(worker_id, job_id) WHERE revoked_at IS NULL;

GRANT SELECT ON public.worker_job_links TO authenticated;
GRANT ALL ON public.worker_job_links TO service_role;
ALTER TABLE public.worker_job_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or own business read worker links" ON public.worker_job_links
  FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id, false));