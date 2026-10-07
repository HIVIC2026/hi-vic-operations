-- Office-only flag: Mitti instructions are shown to a partner only after the office has invited them to Mitti.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS mitti_account_invited boolean NOT NULL DEFAULT false;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS mitti_account_invited_at timestamptz;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS mitti_account_invited_by uuid;
COMMENT ON COLUMN public.businesses.mitti_account_invited IS 'Office-only. When false, partners never see Mitti instructions.';
