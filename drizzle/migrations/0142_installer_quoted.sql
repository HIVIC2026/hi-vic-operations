-- Jo 7 Oct 5:46pm: installer's "Quoted? Yes / No" answer per job. NULL = still waiting on the installer.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS installer_quoted text;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_installer_quoted_chk CHECK (installer_quoted IS NULL OR installer_quoted IN ('yes', 'no'));
ALTER TABLE public.jobs ADD CONSTRAINT jobs_installer_quoted_yes_price_chk CHECK (installer_quoted IS DISTINCT FROM 'yes' OR coalesce(installer_quoted_price_inc_gst, 0) > 0);
COMMENT ON COLUMN public.jobs.installer_quoted IS 'Installer answer to Quoted? (yes = installer_quoted_price_inc_gst kept exactly; no = Quote needed from installer; null = answer needed)';
UPDATE public.jobs SET installer_quoted = 'yes' WHERE channel = 'installer_sourced' AND installer_quoted IS NULL AND installer_quoted_price_inc_gst > 0;