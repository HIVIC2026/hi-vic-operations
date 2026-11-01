-- PENDING ONLY: office-recorded ESC scheme participant status. Never apply without Jo's approval.
ALTER TABLE public.partner_workers ADD COLUMN IF NOT EXISTS esc_registered boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_workers ADD COLUMN IF NOT EXISTS esc_registered_at date;
ALTER TABLE public.partner_workers ADD COLUMN IF NOT EXISTS esc_registered_by uuid;
CREATE OR REPLACE FUNCTION public.guard_worker_esc_registration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (NEW.esc_registered,NEW.esc_registered_at,NEW.esc_registered_by) IS DISTINCT FROM
     (OLD.esc_registered,OLD.esc_registered_at,OLD.esc_registered_by) THEN
    IF current_setting('hivic.esc_registration_actor',true) IS DISTINCT FROM NEW.esc_registered_by::text
      OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=NEW.esc_registered_by AND role::text='admin')
      OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=NEW.esc_registered_by AND role::text='qa_office') THEN
      RAISE EXCEPTION 'Office only';
    END IF;
    IF NEW.trade_role::text<>'installer' OR (NEW.esc_registered AND NEW.esc_registered_at IS NULL) THEN
      RAISE EXCEPTION 'Installer and registration date required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_worker_esc_registration BEFORE UPDATE ON public.partner_workers FOR EACH ROW EXECUTE FUNCTION public.guard_worker_esc_registration();
CREATE OR REPLACE FUNCTION public.record_worker_esc_registration(_worker uuid,_registered boolean,_date date,_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN RAISE EXCEPTION 'Office only'; END IF;
  IF _registered AND (_date IS NULL OR _date>current_date) THEN RAISE EXCEPTION 'Registration date required'; END IF;
  PERFORM 1 FROM public.partner_workers WHERE id=_worker AND trade_role::text='installer' AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installer not found'; END IF;
  PERFORM set_config('hivic.esc_registration_actor',_actor::text,true);
  UPDATE public.partner_workers SET esc_registered=_registered,esc_registered_at=CASE WHEN _registered THEN _date ELSE NULL END,esc_registered_by=_actor WHERE id=_worker;
  INSERT INTO public.admin_config_events(actor_id,event_type,summary,details)
    VALUES(_actor,'worker_esc_registration_recorded','Office recorded ESC scheme participant status',jsonb_build_object('worker_id',_worker,'registered',_registered,'date',_date));
END $$;
REVOKE ALL ON FUNCTION public.record_worker_esc_registration(uuid,boolean,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_worker_esc_registration(uuid,boolean,date,uuid) TO service_role;