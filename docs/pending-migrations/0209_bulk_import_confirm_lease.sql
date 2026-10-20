-- 0209: resumable bulk-import confirmation. A row stays 'pending' until EVERY record for it is saved; a short lease
-- stops two confirm clicks/tabs working the same row at once, and the last failure reason stays visible for retry.
ALTER TABLE public.bulk_import_rows
  ADD COLUMN IF NOT EXISTS confirm_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_error text;
