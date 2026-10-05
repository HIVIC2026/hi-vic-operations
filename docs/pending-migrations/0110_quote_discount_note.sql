-- 0110 Additive: quotes.discount_note records the plain-English reason when a discount guardrail changed the
-- amount (program maximum cap and/or $200 minimum contribution). NULL on all existing quotes = no note.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS discount_note text;
COMMENT ON COLUMN public.quotes.discount_note IS 'Customer-facing note when the discount was capped at the program maximum or reduced for the $200 minimum contribution. NULL = unadjusted.';
