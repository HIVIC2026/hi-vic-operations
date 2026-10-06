-- Electrician licence expiry + installer PIISA training on the worker profile.
ALTER TABLE public.partner_workers
  ADD COLUMN IF NOT EXISTS licence_expires_on date,
  ADD COLUMN IF NOT EXISTS piisa_status text CHECK (piisa_status IN ('done','not_done')),
  ADD COLUMN IF NOT EXISTS piisa_completed_on date,
  ADD COLUMN IF NOT EXISTS piisa_certificate_path text,
  ADD COLUMN IF NOT EXISTS piisa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS piisa_verified_by uuid REFERENCES auth.users(id);
COMMENT ON COLUMN public.partner_workers.piisa_certificate_path IS 'Private partner-files path; served only through signed/app-domain access.';
