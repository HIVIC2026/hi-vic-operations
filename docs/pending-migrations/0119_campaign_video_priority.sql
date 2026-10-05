ALTER TABLE public.lead_campaign_responses
  ADD COLUMN queue_priority text NOT NULL DEFAULT 'standard'
  CHECK (queue_priority IN ('standard','video'));

ALTER TABLE public.customer_delivery_settings
  ADD COLUMN ready_check_available_postcodes text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX lead_campaign_responses_priority_idx
  ON public.lead_campaign_responses (queue_priority DESC, spot_saved_at ASC)
  WHERE spot_saved_at IS NOT NULL AND opted_out_at IS NULL;

COMMENT ON COLUMN public.customer_delivery_settings.ready_check_available_postcodes IS
  'Postcodes where campaign customers may choose Ready Check times. Empty means unavailable everywhere.';