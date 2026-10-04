-- Rollback 0091. Only safe when no row has status 'query' and the new columns hold no data.
ALTER TABLE public.veec_lodgements
  DROP COLUMN reply_sent_by, DROP COLUMN reply_sent_at, DROP COLUMN reply_draft,
  DROP COLUMN query_received_at, DROP COLUMN query_text;
ALTER TABLE public.veec_lodgements DROP CONSTRAINT veec_lodgements_status_check;
ALTER TABLE public.veec_lodgements ADD CONSTRAINT veec_lodgements_status_check
  CHECK (status IN ('not_submitted','submitted','approved','rejected'));
