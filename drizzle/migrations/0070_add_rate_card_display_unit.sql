ALTER TABLE public.rate_card_items ADD COLUMN IF NOT EXISTS display_unit text;
ALTER TABLE public.rate_card_items ADD CONSTRAINT rate_card_items_display_unit_length CHECK (display_unit IS NULL OR char_length(btrim(display_unit)) BETWEEN 1 AND 30);
COMMENT ON COLUMN public.rate_card_items.display_unit IS 'Customer-entered supplier unit label; unit remains the normalized calculation unit.';