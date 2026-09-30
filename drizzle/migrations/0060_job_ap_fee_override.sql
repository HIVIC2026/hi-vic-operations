ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ap_fee_override_inc_gst numeric(10,2) CHECK (ap_fee_override_inc_gst IS NULL OR (ap_fee_override_inc_gst >= 0 AND ap_fee_override_inc_gst <= 100000));
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ap_fee_override_reason text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ap_fee_override_by uuid;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ap_fee_override_at timestamptz;