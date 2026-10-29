-- Rollback for separate-invoices.sql. Stops with an error if any repeat safety check invoice exists (they have no quote,
-- so the old rule can't hold); settle or remove those first. The enum value 'repeat_safety_check' stays (Postgres can't drop one) and is harmless.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices WHERE quote_id IS NULL OR repeat_key IS NOT NULL OR kind::text = 'repeat_safety_check') THEN
    RAISE EXCEPTION 'separate-invoices rollback: repeat safety check invoices exist; remove them first';
  END IF;
END $$;

DROP INDEX IF EXISTS public.invoices_job_repeat_key_idx;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_key_check;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_repeat_quote_check;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS repeat_key;
ALTER TABLE public.invoices ALTER COLUMN quote_id SET NOT NULL;
