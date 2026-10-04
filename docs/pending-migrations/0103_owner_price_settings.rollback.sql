-- Undo 0103: removes only the function and the VEEC buy price column. Version rows published since stay as history.
DROP FUNCTION IF EXISTS public.publish_owner_prices(uuid, jsonb, text);
ALTER TABLE public.retail_estimator_settings DROP CONSTRAINT IF EXISTS retail_estimator_veec_buy_price_positive;
ALTER TABLE public.retail_estimator_settings DROP COLUMN IF EXISTS veec_buy_price;
