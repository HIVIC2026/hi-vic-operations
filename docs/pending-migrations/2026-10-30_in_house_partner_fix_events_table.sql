-- PENDING ONLY. Correct the already-installed trigger without changing configuration values.
-- Job-less office configuration history belongs in admin_config_events; workflow_events requires a job.
CREATE OR REPLACE FUNCTION public.guard_in_house_partner() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF NEW.in_house IS NOT DISTINCT FROM OLD.in_house AND NEW.rectification_billed_by IS NOT DISTINCT FROM OLD.rectification_billed_by THEN RETURN NEW; END IF;
  IF current_user NOT IN ('postgres', 'service_role') AND NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Only the office can change in-house partner configuration';
  END IF;
  actor := COALESCE(NULLIF(current_setting('hivic.in_house_actor', true), '')::uuid, auth.uid());
  IF actor IS NULL THEN RAISE EXCEPTION 'Office actor is required'; END IF;
  NEW.updated_at := now();
  IF NEW.in_house IS DISTINCT FROM OLD.in_house THEN NEW.in_house_set_at := now(); NEW.in_house_set_by := actor; END IF;
  INSERT INTO public.admin_config_events(actor_id, event_type, summary, details)
  VALUES (actor, 'in_house_partner_changed', 'Office changed in-house partner configuration',
    jsonb_build_object('business_id', NEW.id,
      'old', jsonb_build_object('in_house', OLD.in_house, 'rectification_billed_by', OLD.rectification_billed_by),
      'new', jsonb_build_object('in_house', NEW.in_house, 'rectification_billed_by', NEW.rectification_billed_by)));
  RETURN NEW;
END;
$$;