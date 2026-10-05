DROP INDEX IF EXISTS public.lead_campaign_responses_priority_idx;
ALTER TABLE public.customer_delivery_settings DROP COLUMN IF EXISTS ready_check_available_postcodes;
ALTER TABLE public.lead_campaign_responses DROP COLUMN IF EXISTS queue_priority;