ALTER TABLE public.electrician_nominations
  ADD COLUMN IF NOT EXISTS installer_application_id uuid REFERENCES public.rec_onboarding_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS electrician_application_id uuid REFERENCES public.rec_onboarding_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_link_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS teamed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_confirmed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS electrician_nominations_invite_token_uidx ON public.electrician_nominations(invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS electrician_nominations_app_email_uidx ON public.electrician_nominations(installer_application_id, lower(email)) WHERE installer_application_id IS NOT NULL AND job_id IS NULL AND email IS NOT NULL;
ALTER TABLE public.partner_relationships ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_relationships ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.electrician_nominations.status IS 'Lifecycle: invite_pending_comms (drafted), invite_sent, opened, accepted (signed up / onboarding), awaiting_approval, teamed, declined, expired, ended. Job-level nominations keep their prior values.';