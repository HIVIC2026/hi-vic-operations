ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mitti_user_id text,
  ADD COLUMN IF NOT EXISTS mitti_checked_email text,
  ADD COLUMN IF NOT EXISTS mitti_checked_at timestamptz;

COMMENT ON COLUMN public.profiles.mitti_user_id IS 'Mitti user id when this person was confirmed present in the Home Insulation Victoria Mitti organisation; null = not in Mitti at last check.';
COMMENT ON COLUMN public.profiles.mitti_checked_email IS 'Email that was checked in Mitti. If profiles.email later differs, the check no longer proves anything.';
COMMENT ON COLUMN public.profiles.mitti_checked_at IS 'When Mitti membership was last verified for this person.';