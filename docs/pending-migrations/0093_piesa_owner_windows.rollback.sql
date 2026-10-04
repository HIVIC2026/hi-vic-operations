-- Rollback 0093. Owner-picked windows become ordinary (unused) rows; the fallback accept path is untouched.
DROP FUNCTION IF EXISTS public.accept_partner_offer_slot(uuid, uuid, uuid);
DROP INDEX IF EXISTS public.appointment_proposals_piesa_windows_idx;
ALTER TABLE public.appointment_proposals DROP COLUMN IF EXISTS piesa_window_round;
