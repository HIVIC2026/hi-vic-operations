-- Roll back only before the new confirmation/repair path has stored durable work.
-- Existing intake snapshots and repair audit must never be discarded by a rollback.
BEGIN;
-- Wait for in-flight claims/finishes/repairs, then exclude every writer until the guard and DDL commit together.
LOCK TABLE public.bulk_import_batches,public.bulk_import_rows,public.bulk_import_attachment_repairs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.bulk_import_rows WHERE confirm_claim_token IS NOT NULL OR confirm_snapshot IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.bulk_import_attachment_repairs) THEN
    RAISE EXCEPTION 'Bulk confirmation or repair history exists. Retain it and use a reviewed forward repair instead of rollback';
  END IF;
END $$;
DROP TRIGGER bulk_import_row_writer ON public.bulk_import_rows;
DROP FUNCTION public.guard_bulk_import_row_writer();
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
    '_bulk_import_access','_bulk_import_claimed','_bulk_import_document','_bulk_import_quote_complete','claim_bulk_import_row',
    'release_bulk_import_row','edit_bulk_import_row','set_bulk_import_plan','prepare_bulk_import_job','finish_bulk_import_row',
    'close_bulk_import_batch','bulk_import_batch_counts','repair_bulk_import_attachment','save_bulk_import_analysis','renew_bulk_import_row']) LOOP
    EXECUTE format('DROP FUNCTION %s',f.signature);
  END LOOP;
END $$;
DROP TABLE public.bulk_import_attachment_repairs;
ALTER TABLE public.bulk_import_rows DROP COLUMN confirm_claim_token,DROP COLUMN confirm_snapshot;
-- Restore only the reviewed 0104 grants; do not reintroduce undocumented broader live privileges.
GRANT SELECT,INSERT,UPDATE ON public.bulk_import_batches,public.bulk_import_rows TO authenticated;
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


COMMIT;
