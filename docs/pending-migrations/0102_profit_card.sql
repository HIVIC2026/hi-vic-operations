-- Per-job profit card (office only). Additive only; existing rows keep their values.
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS current_veec_price numeric(10,2) NOT NULL DEFAULT 83 CHECK (current_veec_price > 0 AND current_veec_price < 1000);
ALTER TABLE public.veec_lodgements ADD COLUMN IF NOT EXISTS sale_price_per_veec numeric(10,2) CHECK (sale_price_per_veec IS NULL OR (sale_price_per_veec > 0 AND sale_price_per_veec < 1000));
COMMENT ON COLUMN public.workflow_settings.current_veec_price IS 'Office-editable expected VEEC sale price for the per-job profit card';
COMMENT ON COLUMN public.veec_lodgements.sale_price_per_veec IS 'Actual VEEC sale price once sold; replaces current_veec_price on the profit card';
