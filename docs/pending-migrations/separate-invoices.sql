-- Separate invoices (batch 3b): a job can carry a fixes invoice and repeat safety check invoices next to the install one.
-- NOT RUN on the live database. Proven on a practice database (tests/batch3b-invoices-db.test.ts). Re-runnable.
--  * kind gains 'repeat_safety_check'; fixes invoices keep kind 'rectification' and still point at their fixes quote.
--  * A repeat safety check invoice has no quote: quote_id is empty and repeat_key (e.g. 'reopen:<iso>') is set.
--  * One invoice per quote stays (invoices_quote_id_key). One repeat invoice per job and repeat_key.
-- The checks compare kind::text so this file also works when the whole file runs as one transaction
-- (a brand-new enum value can't be used inside the transaction that adds it).

ALTER TYPE public.quote_kind ADD VALUE IF NOT EXISTS 'repeat_safety_check';

ALTER TABLE public.invoices ALTER COLUMN quote_id DROP NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS repeat_key text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_quote_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_repeat_quote_check
  CHECK ((kind::text = 'repeat_safety_check') = (quote_id IS NULL));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_key_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_repeat_key_check
  CHECK ((kind::text = 'repeat_safety_check') = (repeat_key IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_repeat_key_idx ON public.invoices (job_id, repeat_key) WHERE repeat_key IS NOT NULL;
