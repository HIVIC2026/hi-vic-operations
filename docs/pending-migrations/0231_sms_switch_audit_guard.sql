-- Jo 29 Oct 2026: every text/email switch in workflow_settings.sms_message_switches
-- was found Off with no audit row and no updated_at change (out-of-band write, not the app).
-- 1) Any change to the switches now always writes one admin_config_events row (who/db role/from/to/changed keys)
--    and bumps updated_at, whatever wrote it (app, SQL tool, script).
-- 2) A write that changes more than one switch at once is refused unless that transaction first runs
--    SELECT set_config('hivic.bulk_switch_change', 'approved', true);
--    ("*_activated_at" timestamp keys don't count, so the reminder switch save still works.)
-- Current switch values are not changed.

CREATE OR REPLACE FUNCTION public.guard_sms_message_switches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text;
  changed text[] := '{}';
  counted int := 0;
  actor uuid;
BEGIN
  IF NEW.sms_message_switches IS NOT DISTINCT FROM OLD.sms_message_switches THEN
    RETURN NEW;
  END IF;
  FOR k IN
    SELECT key FROM jsonb_object_keys(coalesce(OLD.sms_message_switches, '{}'::jsonb)) AS key
    UNION SELECT key FROM jsonb_object_keys(coalesce(NEW.sms_message_switches, '{}'::jsonb)) AS key
  LOOP
    IF (OLD.sms_message_switches -> k) IS DISTINCT FROM (NEW.sms_message_switches -> k) THEN
      changed := changed || k;
      IF k NOT LIKE '%\_activated\_at' THEN counted := counted + 1; END IF;
    END IF;
  END LOOP;
  IF counted > 1 AND coalesce(current_setting('hivic.bulk_switch_change', true), '') <> 'approved' THEN
    RAISE EXCEPTION 'Refused: % text/email switches changed in one write (%). Change one switch at a time.', counted, array_to_string(changed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  BEGIN actor := auth.uid(); EXCEPTION WHEN others THEN actor := NULL; END;
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details)
  VALUES (actor, 'sms_switches_db_change',
    'Text/email switches changed: ' || array_to_string(changed, ', '),
    jsonb_build_object('changed', to_jsonb(changed), 'db_role', current_user, 'application', current_setting('application_name', true),
      'from', OLD.sms_message_switches, 'to', NEW.sms_message_switches));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_sms_message_switches() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_sms_message_switches ON public.workflow_settings;
CREATE TRIGGER trg_guard_sms_message_switches
  BEFORE UPDATE OF sms_message_switches ON public.workflow_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_sms_message_switches();
