-- Offer timing rule (Jo, 7 Oct 2026): hours before trades may "Suggest another time" on Ready Check / PIESA offers.
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS offer_suggest_time_after_hours integer NOT NULL DEFAULT 24;
ALTER TABLE public.workflow_settings DROP CONSTRAINT IF EXISTS workflow_settings_offer_suggest_hours_chk;
ALTER TABLE public.workflow_settings ADD CONSTRAINT workflow_settings_offer_suggest_hours_chk CHECK (offer_suggest_time_after_hours BETWEEN 1 AND 336);
COMMENT ON COLUMN public.workflow_settings.offer_suggest_time_after_hours IS 'Real hours after an offer goes out before trades who still hold it may suggest another time (and office sees no-taker in Needs me).';
