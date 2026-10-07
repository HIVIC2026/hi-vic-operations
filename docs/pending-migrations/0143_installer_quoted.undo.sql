ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_installer_quoted_yes_price_chk;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_installer_quoted_chk;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS installer_quoted;
