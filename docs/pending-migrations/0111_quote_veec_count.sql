-- 0111 Additive: office-built HIV quotes record the whole-VEEC basis of the VEU discount so the quote line can read
-- "VEU discount, 21 VEECs × $70". NULL on every existing quote = older method; existing rows are not touched.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS veec_count integer;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS veec_unit_value_inc_gst numeric(10,2);
COMMENT ON COLUMN public.quotes.veec_count IS 'Whole VEECs (Eq 48.1 rounded down) behind veec_discount_inc_gst. NULL = legacy/manual discount basis.';
COMMENT ON COLUMN public.quotes.veec_unit_value_inc_gst IS 'Consumer $ per VEEC used for the discount. NULL = legacy/manual discount basis.';
