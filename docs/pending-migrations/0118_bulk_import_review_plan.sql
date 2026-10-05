-- Bulk import review choices. Details remain on the batch/row so the confirmed job history is exact.
ALTER TABLE public.bulk_import_batches
  ADD COLUMN electrician_plan jsonb NOT NULL DEFAULT '{"mode":"hivic"}'::jsonb;

ALTER TABLE public.bulk_import_rows
  ADD COLUMN import_stage text NOT NULL DEFAULT 'not_visited',
  ADD COLUMN electrician_plan jsonb,
  ADD COLUMN office_review_reason text,
  ADD CONSTRAINT bulk_import_rows_import_stage_check
    CHECK (import_stage IN ('not_visited','visited','quoted','installed'));

COMMENT ON COLUMN public.bulk_import_batches.electrician_plan IS
  'Batch-wide safety-check choice. Per-row choice overrides it only when mode is job_by_job.';
COMMENT ON COLUMN public.bulk_import_rows.import_stage IS
  'Installer-confirmed progress at import: not_visited, visited, quoted or installed.';
COMMENT ON COLUMN public.bulk_import_rows.electrician_plan IS
  'Private row-level safety-check choice; never expose another installer network.';

CREATE OR REPLACE FUNCTION public.guard_confirmed_bulk_import()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'bulk_import_batches' THEN
    IF OLD.status IN ('confirmed','discarded') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Confirmed or discarded bulk uploads are permanent history';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO parent_status FROM public.bulk_import_batches WHERE id = OLD.batch_id;
  IF parent_status IN ('confirmed','discarded') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Rows in a confirmed or discarded bulk upload are permanent history';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_confirmed_bulk_import_batches
BEFORE UPDATE OR DELETE ON public.bulk_import_batches
FOR EACH ROW EXECUTE FUNCTION public.guard_confirmed_bulk_import();

CREATE TRIGGER guard_confirmed_bulk_import_rows
BEFORE UPDATE OR DELETE ON public.bulk_import_rows
FOR EACH ROW EXECUTE FUNCTION public.guard_confirmed_bulk_import();