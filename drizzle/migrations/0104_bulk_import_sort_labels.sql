-- Bulk import sorting is by Ready Check coverage, not quote-readiness (Jo correction 5 Oct 2026).
-- 'ready_to_quote' becomes 'covers_ready_check'. Feature unused so far, so no existing rows are affected.
ALTER TABLE public.bulk_import_rows DROP CONSTRAINT bulk_import_rows_sort_result_check;
ALTER TABLE public.bulk_import_rows ADD CONSTRAINT bulk_import_rows_sort_result_check
  CHECK (sort_result IN ('covers_ready_check', 'needs_visit', 'office_review'));
COMMENT ON COLUMN public.bulk_import_rows.sort_result IS 'Ready Check coverage: covers_ready_check (small gaps → install-day list) / needs_visit (key items missing) / office_review';
COMMENT ON COLUMN public.bulk_import_rows.extracted IS '{full_name,email,phone,address_line,suburb,postcode,area_m2,existing_insulation,access,roof_type,hazards,building_age,notes,price_inc_gst}';