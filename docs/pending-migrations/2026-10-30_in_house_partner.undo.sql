-- Undo configuration and the scoped rate cards created by this migration.
-- Retain in_house_partner_changed history: deleting accepted office changes would destroy the permanent audit trail.
DELETE FROM public.rate_card_items WHERE rate_card_id IN (
  SELECT id FROM public.rate_cards WHERE name = 'In-house PIESA' AND kind = 'electrical'
  AND business_id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb')
);
DELETE FROM public.rate_cards WHERE name = 'In-house PIESA' AND kind = 'electrical'
AND business_id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb');
DROP FUNCTION IF EXISTS public.save_in_house_partner(uuid, boolean, text, uuid);
DROP TRIGGER IF EXISTS trg_guard_in_house_partner ON public.businesses;
DROP FUNCTION IF EXISTS public.guard_in_house_partner();
ALTER TABLE public.businesses
  DROP COLUMN IF EXISTS rectification_billed_by,
  DROP COLUMN IF EXISTS in_house_set_by,
  DROP COLUMN IF EXISTS in_house_set_at,
  DROP COLUMN IF EXISTS in_house;