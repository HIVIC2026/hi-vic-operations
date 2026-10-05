-- Undo for 0111_quote_veec_count.sql. App code must stop writing these columns first.
ALTER TABLE public.quotes DROP COLUMN IF EXISTS veec_unit_value_inc_gst;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS veec_count;
