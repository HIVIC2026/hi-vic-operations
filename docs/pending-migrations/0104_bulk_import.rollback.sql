-- Undo 0104_bulk_import: removes ONLY the two new bulk-import tables.
-- Jobs already created from a confirmed batch are NOT touched (they are real jobs with audit history).
DROP TABLE public.bulk_import_rows;
DROP TABLE public.bulk_import_batches;
