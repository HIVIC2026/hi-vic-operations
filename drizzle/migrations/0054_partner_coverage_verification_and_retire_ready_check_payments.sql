ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS declared_service_origin text,
  ADD COLUMN IF NOT EXISTS declared_travel_radius_km integer,
  ADD COLUMN IF NOT EXISTS declared_excluded_areas text,
  ADD COLUMN IF NOT EXISTS free_measureups_for_hivic_quote_leads boolean,
  ADD COLUMN IF NOT EXISTS coverage_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS coverage_verified_by uuid;

COMMENT ON COLUMN public.businesses.declared_service_origin IS 'Partner-declared service origin from signed onboarding; informational until office postcode verification.';
COMMENT ON COLUMN public.businesses.declared_travel_radius_km IS 'Partner-declared travel radius from signed onboarding; informational until office postcode verification.';
COMMENT ON COLUMN public.businesses.declared_excluded_areas IS 'Partner-declared service exclusions from signed onboarding; must be reviewed when verifying postcodes.';
COMMENT ON COLUMN public.businesses.free_measureups_for_hivic_quote_leads IS 'Installer agreement to provide free HI VIC quote-lead measure-ups; null for non-installers or legacy records.';
COMMENT ON COLUMN public.businesses.coverage_verified_at IS 'Office confirmation time for machine-matchable service_postcodes.';
COMMENT ON COLUMN public.businesses.coverage_verified_by IS 'Office user who confirmed machine-matchable service_postcodes.';

REVOKE EXECUTE ON FUNCTION public.accept_ready_check_test(uuid, uuid, text, integer, numeric, numeric, numeric, text, jsonb, inet, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.apply_ready_check_test_payment(uuid, text, text) FROM service_role;
COMMENT ON FUNCTION public.accept_ready_check_test(uuid, uuid, text, integer, numeric, numeric, numeric, text, jsonb, inet, text) IS 'DEPRECATED: historical test-only paid Ready Check RPC; execution revoked because new Ready Checks are free.';
COMMENT ON FUNCTION public.apply_ready_check_test_payment(uuid, text, text) IS 'DEPRECATED: historical test-only paid Ready Check payment RPC; execution revoked because new Ready Checks are free.';