-- Delivery result (what the receiving mail server did) for sent emails. Additive only.
ALTER TABLE public.customer_email_sends
  ADD COLUMN IF NOT EXISTS delivery_result text NULL,
  ADD COLUMN IF NOT EXISTS delivery_detail text NULL,
  ADD COLUMN IF NOT EXISTS delivery_at timestamptz NULL;
ALTER TABLE public.customer_email_sends
  DROP CONSTRAINT IF EXISTS customer_email_sends_delivery_result_check;
ALTER TABLE public.customer_email_sends
  ADD CONSTRAINT customer_email_sends_delivery_result_check
  CHECK (delivery_result IS NULL OR delivery_result IN ('delivered', 'bounced'));

ALTER TABLE public.job_communications
  ADD COLUMN IF NOT EXISTS delivery_result text NULL,
  ADD COLUMN IF NOT EXISTS delivery_detail text NULL,
  ADD COLUMN IF NOT EXISTS delivery_at timestamptz NULL;
ALTER TABLE public.job_communications
  DROP CONSTRAINT IF EXISTS job_communications_delivery_result_check;
ALTER TABLE public.job_communications
  ADD CONSTRAINT job_communications_delivery_result_check
  CHECK (delivery_result IS NULL OR delivery_result IN ('delivered', 'bounced'));

CREATE INDEX IF NOT EXISTS customer_email_sends_provider_message_id_idx
  ON public.customer_email_sends (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_communications_provider_message_id_idx
  ON public.job_communications (provider_message_id) WHERE provider_message_id IS NOT NULL;
