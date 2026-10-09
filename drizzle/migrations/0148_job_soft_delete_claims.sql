CREATE OR REPLACE FUNCTION public.block_deleted_job_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text = ANY (TG_ARGV::text[])
     AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This job is deleted; queued work cannot be claimed or retried';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS block_deleted_job_claim ON public.customer_email_sends;
CREATE TRIGGER block_deleted_job_claim BEFORE UPDATE ON public.customer_email_sends FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_claim('pending','queued','reserved','sending','processing','retry');
DROP TRIGGER IF EXISTS block_deleted_job_claim ON public.sms_messages;
CREATE TRIGGER block_deleted_job_claim BEFORE UPDATE ON public.sms_messages FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_claim('pending','queued','reserved','sending','processing','retry');
DROP TRIGGER IF EXISTS block_deleted_job_claim ON public.external_action_outbox;
CREATE TRIGGER block_deleted_job_claim BEFORE UPDATE ON public.external_action_outbox FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_claim('pending','queued','reserved','sending','processing','retry','claimed','in_progress');
DROP TRIGGER IF EXISTS block_deleted_job_claim ON public.bookings;
CREATE TRIGGER block_deleted_job_claim BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_claim('proposed','confirmed');
DROP TRIGGER IF EXISTS block_deleted_job ON public.bookings;
CREATE TRIGGER block_deleted_job BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.block_deleted_job_child('raise');