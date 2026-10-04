ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS daily_job_limit integer;
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_daily_job_limit_positive;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_daily_job_limit_positive CHECK (daily_job_limit IS NULL OR daily_job_limit > 0);
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS rec_offer_business_hours numeric NOT NULL DEFAULT 4;
COMMENT ON COLUMN public.businesses.daily_job_limit IS 'Optional max confirmed electrician jobs per day; NULL = no limit.';
COMMENT ON COLUMN public.workflow_settings.rec_offer_business_hours IS 'Electrician offer deadline in Melbourne business hours (8am-5pm weekdays, excl. Vic public holidays).';
COMMENT ON COLUMN public.workflow_settings.rec_offer_expiry_hours IS 'DEPRECATED: replaced by rec_offer_business_hours';