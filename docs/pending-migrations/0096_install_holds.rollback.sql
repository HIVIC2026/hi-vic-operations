DROP FUNCTION IF EXISTS public.place_install_hold(uuid, uuid, numeric, date, text, boolean);
DROP TABLE IF EXISTS public.install_holds;
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_daily_capacity_m2_positive;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS daily_capacity_m2;
