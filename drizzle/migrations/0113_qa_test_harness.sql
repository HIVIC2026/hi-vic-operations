-- TEST Centre isolation and cleanup support. No live workflow rules are changed.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS qa_archived_at timestamptz;
COMMENT ON COLUMN public.jobs.qa_archived_at IS 'TEST-only archive marker. Must remain null unless source = qa_test.';

CREATE OR REPLACE FUNCTION public.guard_qa_archive() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.qa_archived_at IS NOT NULL AND NEW.source IS DISTINCT FROM 'qa_test' THEN
    RAISE EXCEPTION 'Only qa_test jobs may be archived by the Test Centre';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_guard_qa_archive ON public.jobs;
CREATE TRIGGER jobs_guard_qa_archive BEFORE INSERT OR UPDATE OF qa_archived_at, source ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_qa_archive();