DROP TRIGGER IF EXISTS guard_confirmed_bulk_import_rows ON public.bulk_import_rows;
DROP TRIGGER IF EXISTS guard_confirmed_bulk_import_batches ON public.bulk_import_batches;
DROP FUNCTION IF EXISTS public.guard_confirmed_bulk_import();
ALTER TABLE public.bulk_import_rows DROP CONSTRAINT IF EXISTS bulk_import_rows_import_stage_check;
ALTER TABLE public.bulk_import_rows DROP COLUMN IF EXISTS office_review_reason;
ALTER TABLE public.bulk_import_rows DROP COLUMN IF EXISTS electrician_plan;
ALTER TABLE public.bulk_import_rows DROP COLUMN IF EXISTS import_stage;
ALTER TABLE public.bulk_import_batches DROP COLUMN IF EXISTS electrician_plan;