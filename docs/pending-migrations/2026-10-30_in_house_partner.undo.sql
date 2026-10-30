-- Undo configuration only. Retain rate-card prices and permanent workflow history.
DROP FUNCTION IF EXISTS public.save_in_house_partner(uuid, boolean, text, uuid);
DROP TRIGGER IF EXISTS trg_guard_in_house_partner ON public.businesses;
DROP FUNCTION IF EXISTS public.guard_in_house_partner();
ALTER TABLE public.businesses
  DROP COLUMN IF EXISTS rectification_billed_by,
  DROP COLUMN IF EXISTS in_house_set_by,
  DROP COLUMN IF EXISTS in_house_set_at,
  DROP COLUMN IF EXISTS in_house;