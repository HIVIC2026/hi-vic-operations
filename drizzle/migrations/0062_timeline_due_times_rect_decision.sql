ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS no_rectification_confirmed boolean;
COMMENT ON COLUMN public.assessments.no_rectification_confirmed IS 'Electrician explicitly confirms no rectification is required (same-day PIESA submission rule). Either this is true or at least one priced rectification item exists.';
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS due_trade_reply_warn_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS due_trade_reply_exception_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS due_owner_reminder_days integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS due_owner_flag_days integer NOT NULL DEFAULT 7;