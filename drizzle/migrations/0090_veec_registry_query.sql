-- Add "query" VEEC status and registry-query fields. Additive; existing rows unchanged.
ALTER TABLE public.veec_lodgements DROP CONSTRAINT veec_lodgements_status_check;
ALTER TABLE public.veec_lodgements ADD CONSTRAINT veec_lodgements_status_check
  CHECK (status IN ('not_submitted','submitted','query','approved','rejected'));
ALTER TABLE public.veec_lodgements
  ADD COLUMN query_text text,
  ADD COLUMN query_received_at date,
  ADD COLUMN reply_draft text,
  ADD COLUMN reply_sent_at date,
  ADD COLUMN reply_sent_by uuid;