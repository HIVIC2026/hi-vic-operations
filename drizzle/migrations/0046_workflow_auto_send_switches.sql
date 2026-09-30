ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS auto_send_quote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_send_rec boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_send_installer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_send_mitti boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.workflow_settings.auto_send_quote IS 'Auto-send measured quote to owner after Mitti sync. Default off (manual confirm at launch).';
COMMENT ON COLUMN public.workflow_settings.auto_send_rec IS 'Auto-send PIESA request to REC after acceptance + deposit. Default off.';
COMMENT ON COLUMN public.workflow_settings.auto_send_installer IS 'Auto-send install job to measuring installer after PIESA pass. Default off.';
COMMENT ON COLUMN public.workflow_settings.auto_send_mitti IS 'Auto-create pre-filled Mitti forms on booking. Default off.';