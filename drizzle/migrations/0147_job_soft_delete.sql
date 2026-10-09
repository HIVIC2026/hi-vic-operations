-- Office "Delete job": recoverable soft delete for ANY job. Never removes signed, financial or audit rows.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_reason text;
COMMENT ON COLUMN public.jobs.deleted_at IS 'Office soft delete: set = job removed from every operational view, send and automation; restorable by office admin.';
CREATE INDEX IF NOT EXISTS jobs_deleted_at_idx ON public.jobs (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_deleted_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.deleted_by IS NULL OR length(coalesce(trim(NEW.deleted_reason), '')) < 3 THEN
      RAISE EXCEPTION 'Deleting a job needs the office admin and a reason';
    END IF;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    RAISE EXCEPTION 'This job is deleted; restore it before changing its stage';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_guard_deleted ON public.jobs;
CREATE TRIGGER jobs_guard_deleted BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_job();

-- New outbound work for a deleted job is refused (emails, texts, external actions, offers); queued intake work is skipped.
CREATE OR REPLACE FUNCTION public.block_deleted_job_child()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.deleted_at IS NOT NULL) THEN
    IF TG_ARGV[0] = 'skip' THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'This job is deleted; nothing new can be sent or started for it';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS block_deleted_job ON public.customer_email_sends;
CREATE TRIGGER block_deleted_job BEFORE INSERT ON public.customer_email_sends FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_child('raise');
DROP TRIGGER IF EXISTS block_deleted_job ON public.sms_messages;
CREATE TRIGGER block_deleted_job BEFORE INSERT ON public.sms_messages FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_child('raise');
DROP TRIGGER IF EXISTS block_deleted_job ON public.external_action_outbox;
CREATE TRIGGER block_deleted_job BEFORE INSERT ON public.external_action_outbox FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_child('raise');
DROP TRIGGER IF EXISTS block_deleted_job ON public.partner_offers;
CREATE TRIGGER block_deleted_job BEFORE INSERT ON public.partner_offers FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_child('raise');
DROP TRIGGER IF EXISTS block_deleted_job ON public.post_intake_work;
CREATE TRIGGER block_deleted_job BEFORE INSERT ON public.post_intake_work FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_child('skip');

-- Trades and owners lose access to deleted jobs; office keeps the retained history.
CREATE OR REPLACE FUNCTION public.can_access_job(_job uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.is_admin()
      or (not exists (select 1 from public.jobs d where d.id = _job and d.deleted_at is not null) and (
            public.job_assignment_role(_job, auth.uid()) is not null
         or public.is_job_owner(_job, auth.uid())
         or exists (select 1 from public.job_assignments ja where ja.job_id = _job and ja.active and ja.business_id is not null and public.is_business_member(ja.business_id, true))))
$function$;
