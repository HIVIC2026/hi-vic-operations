ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS installer_led boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS electrician_choice text CHECK (electrician_choice IN ('installer_own','hivic_matched','installer_own_hivic_books'));
COMMENT ON COLUMN public.jobs.installer_led IS 'Installer brought their own customer: no referral fee; owner pays installer quote + PIESA + AP fee; HI VIC invoices with co-branding.';
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS mitti_ready_check_template_id text;
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS mitti_piesa_template_id text;
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS mitti_piisa_template_id text;
COMMENT ON COLUMN public.workflow_settings.mitti_measureup_template_id IS 'DEPRECATED: replaced by mitti_ready_check_template_id';
UPDATE public.jobs SET installer_led = true WHERE channel = 'installer_sourced';