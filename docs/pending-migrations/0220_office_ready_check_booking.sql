ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS ready_check_booking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ready_check_booking_offered_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ready_check_booking_offered_by uuid;

CREATE OR REPLACE FUNCTION public.owner_ready_check_booking_allowed(_job uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.workflow_settings s, public.jobs j
    WHERE s.id=1 AND s.ready_check_booking_enabled IS TRUE AND j.id=_job
      AND j.ready_check_booking_offered_at IS NOT NULL AND j.ready_check_booking_offered_by IS NOT NULL
      AND j.deleted_at IS NULL AND j.stage NOT IN ('cancelled','complete'));
$$;
REVOKE ALL ON FUNCTION public.owner_ready_check_booking_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_ready_check_booking_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_owner_ready_check_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.owner_ready_check_booking_allowed(NEW.job_id) THEN
    RAISE EXCEPTION 'Ready Check booking is not open. We''ll be in touch when the office offers your booking.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ready_check_acceptance_office_gate BEFORE INSERT ON public.ready_check_acceptances
FOR EACH ROW EXECUTE FUNCTION public.guard_owner_ready_check_booking();
CREATE TRIGGER ready_check_windows_office_gate BEFORE INSERT ON public.ready_check_windows
FOR EACH ROW EXECUTE FUNCTION public.guard_owner_ready_check_booking();

CREATE OR REPLACE FUNCTION public.guard_ready_check_booking_control()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.ready_check_booking_offered_at IS DISTINCT FROM OLD.ready_check_booking_offered_at
    OR NEW.ready_check_booking_offered_by IS DISTINCT FROM OLD.ready_check_booking_offered_by)
    AND NOT public.is_admin() AND current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only office can offer Ready Check booking';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ready_check_booking_control_office_only BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_ready_check_booking_control();

CREATE OR REPLACE FUNCTION public.offer_owner_ready_check_booking(_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only office can offer Ready Check booking'; END IF;
  PERFORM 1 FROM public.workflow_settings WHERE id=1 AND ready_check_booking_enabled IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ready Check booking is switched off'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id=_job FOR UPDATE;
  IF NOT FOUND OR j.deleted_at IS NOT NULL OR j.stage NOT IN
    ('preliminary_estimate_ready','ready_check_awaiting_acceptance','ready_check_ready_to_schedule') THEN
    RAISE EXCEPTION 'This job is not waiting for a Ready Check booking';
  END IF;
  IF j.ready_check_booking_offered_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.jobs SET ready_check_booking_offered_at=now(),ready_check_booking_offered_by=auth.uid() WHERE id=_job;
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
    VALUES(_job,auth.uid(),'owner_ready_check_booking_offered','Office offered Ready Check booking (nothing sent)','{}'::jsonb,true);
END $$;
REVOKE ALL ON FUNCTION public.offer_owner_ready_check_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_owner_ready_check_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_ready_check_booking_enabled(_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only office can change Ready Check booking'; END IF;
  UPDATE public.workflow_settings SET ready_check_booking_enabled=_enabled WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking settings missing'; END IF;
  INSERT INTO public.admin_config_events(actor_id,event_type,summary,details)
    VALUES(auth.uid(),'ready_check_booking_enabled','Office changed owner Ready Check booking',jsonb_build_object('enabled',_enabled));
END $$;
REVOKE ALL ON FUNCTION public.set_ready_check_booking_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ready_check_booking_enabled(boolean) TO authenticated;