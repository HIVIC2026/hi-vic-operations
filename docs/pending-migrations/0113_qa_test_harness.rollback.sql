DROP TRIGGER IF EXISTS jobs_guard_qa_archive ON public.jobs;
DROP FUNCTION IF EXISTS public.guard_qa_archive();
ALTER TABLE public.jobs DROP COLUMN IF EXISTS qa_archived_at;