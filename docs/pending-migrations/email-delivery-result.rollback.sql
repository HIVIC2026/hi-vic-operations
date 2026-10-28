-- Rollback for email-delivery-result.sql: drops the two lookup indexes, the two check constraints and the three
-- delivery columns on each table. The delivery results already recorded are lost; the emails themselves are untouched.
-- Apply only after the code that reads these columns is rolled back. Idempotent.
BEGIN;
DROP INDEX IF EXISTS public.customer_email_sends_provider_message_id_idx;
DROP INDEX IF EXISTS public.job_communications_provider_message_id_idx;
ALTER TABLE public.customer_email_sends DROP CONSTRAINT IF EXISTS customer_email_sends_delivery_result_check;
ALTER TABLE public.job_communications DROP CONSTRAINT IF EXISTS job_communications_delivery_result_check;
ALTER TABLE public.customer_email_sends
  DROP COLUMN IF EXISTS delivery_result,
  DROP COLUMN IF EXISTS delivery_detail,
  DROP COLUMN IF EXISTS delivery_at;
ALTER TABLE public.job_communications
  DROP COLUMN IF EXISTS delivery_result,
  DROP COLUMN IF EXISTS delivery_detail,
  DROP COLUMN IF EXISTS delivery_at;
COMMIT;
