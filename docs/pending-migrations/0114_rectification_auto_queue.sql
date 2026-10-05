-- Rectification auto-queue switch. Default OFF: current office-review-required
-- behaviour (queued only, never auto-sent) is unchanged until explicitly turned on.
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS auto_queue_rectification_quote boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.workflow_settings.auto_queue_rectification_quote IS
  'When true, a freshly generated rectification quote whose lines are ALL standard agreed-rate items (not "Other", not flagged needs_office_pricing, not manually adjusted) is auto-reviewed and auto-issued to the owner instead of waiting in the office review queue. Any other/non-standard/manually-priced line always holds for manual office review, switch on or off. Default false = no behaviour change (queued only).';
