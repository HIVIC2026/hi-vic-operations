DROP TABLE IF EXISTS public.onboarding_test_marks;
DROP FUNCTION IF EXISTS public.guard_onboarding_test_mark();
ALTER TABLE public.businesses
  DROP COLUMN IF EXISTS base_suburb, DROP COLUMN IF EXISTS coverage_lat, DROP COLUMN IF EXISTS coverage_lng,
  DROP COLUMN IF EXISTS coverage_radius_km, DROP COLUMN IF EXISTS covers_all_victoria, DROP COLUMN IF EXISTS public_liability_cover_amount,
  DROP COLUMN IF EXISTS free_quotes_for_hivic_leads, DROP COLUMN IF EXISTS signer_name, DROP COLUMN IF EXISTS signer_position,
  DROP COLUMN IF EXISTS signer_mobile, DROP COLUMN IF EXISTS signer_email, DROP COLUMN IF EXISTS approval_message_status,
  DROP COLUMN IF EXISTS approval_message_queued_at;
