ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_daily_job_limit_positive;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS daily_job_limit;
ALTER TABLE public.workflow_settings DROP COLUMN IF EXISTS rec_offer_business_hours;
