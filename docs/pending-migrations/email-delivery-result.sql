-- Email delivery result (catch-up plan 29 Oct 2026, task 3). Records what the receiving mail server did with a sent
-- email: delivery_result ('delivered' or 'bounced'), delivery_detail (the server's reason) and delivery_at, on both
-- customer_email_sends and job_communications, plus a provider_message_id lookup index on each so the Resend and
-- Outlook bounce hooks can find the row. Additive only; idempotent.
-- Apply BEFORE the code that reads these columns goes live: the portal's email lists and contact history select them,
-- and a missing column makes those queries fail.
-- Proven on PGlite: tests/email-delivery-result-practice-db.test.ts. Rollback: email-delivery-result.rollback.sql.
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
