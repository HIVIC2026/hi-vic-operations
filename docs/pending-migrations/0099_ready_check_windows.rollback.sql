-- Undo step 11 database change (only safe while no ready_check offers exist).
DROP FUNCTION IF EXISTS public.accept_ready_check_offer(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.ready_check_windows;
ALTER TABLE public.partner_offers DROP CONSTRAINT IF EXISTS partner_offers_kind_check;
ALTER TABLE public.partner_offers ADD CONSTRAINT partner_offers_kind_check CHECK (kind IN ('installer', 'piesa', 'rectification'));
