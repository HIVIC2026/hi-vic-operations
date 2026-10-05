-- Undo 0105: restore the original sort_result labels. Only safe while no rows use 'covers_ready_check'.
ALTER TABLE public.bulk_import_rows DROP CONSTRAINT bulk_import_rows_sort_result_check;
ALTER TABLE public.bulk_import_rows ADD CONSTRAINT bulk_import_rows_sort_result_check
  CHECK (sort_result IN ('ready_to_quote', 'needs_visit', 'office_review'));
