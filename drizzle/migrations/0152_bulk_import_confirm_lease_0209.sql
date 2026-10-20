ALTER TABLE public.bulk_import_rows
  ADD COLUMN IF NOT EXISTS confirm_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_error text;