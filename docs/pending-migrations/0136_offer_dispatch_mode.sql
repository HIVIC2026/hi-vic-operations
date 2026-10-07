-- How job offers go out (Jo, 7 Oct 2026). Office picks first is the launch default; Automatic = send to all matching trades.
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS offer_dispatch_mode text NOT NULL DEFAULT 'office_picks';
ALTER TABLE public.workflow_settings DROP CONSTRAINT IF EXISTS workflow_settings_offer_dispatch_mode_chk;
ALTER TABLE public.workflow_settings ADD CONSTRAINT workflow_settings_offer_dispatch_mode_chk CHECK (offer_dispatch_mode IN ('office_picks', 'automatic'));
COMMENT ON COLUMN public.workflow_settings.offer_dispatch_mode IS 'office_picks: Ready Check / safety-check offers wait in Needs me for the office to choose trades. automatic: offered to all matching trades.';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS offer_dispatch_override text;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_offer_dispatch_override_chk;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_offer_dispatch_override_chk CHECK (offer_dispatch_override IS NULL OR offer_dispatch_override = 'office_picks');
COMMENT ON COLUMN public.jobs.offer_dispatch_override IS 'Per-job switch to office_picks even when the global mode is automatic. Null = follow the setting.';
