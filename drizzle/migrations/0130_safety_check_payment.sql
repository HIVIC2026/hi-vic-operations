-- Jo 7 Oct: safety check (PIESA) payment amount is a setting, not hard-coded.
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS safety_check_payment_inc_gst numeric NOT NULL DEFAULT 349;
COMMENT ON COLUMN public.workflow_settings.safety_check_payment_inc_gst IS 'Owner pays this after Step B and before the PIESA is booked (Jo 7 Oct). Kept if the check is done; refunded if it never happens.';
