-- "Pause all trade messages" (Jo 30 Oct 2026, "Yes, add it now"): one office switch. While true, no text or email goes
-- to installers, electricians or their teams (src/lib/trade-pause.core.ts). Default TRUE: nothing goes to trades until
-- Jo turns it off in Settings › Switches. The code treats a missing column as NOT paused.
-- Pending: proven on PGlite (tests/trade-messages-paused.pglite.test.ts); run live only with Jo's OK.
--
-- Same audit style as trg_guard_sms_message_switches (0179/0231): any change to this column, whatever wrote it (app,
-- SQL tool, script), bumps updated_at and writes one admin_config_events row. It is a separate column, so the
-- sms_message_switches trigger (BEFORE UPDATE OF sms_message_switches) never fires for it and never blocks it.
alter table public.workflow_settings add column if not exists trade_messages_paused boolean not null default true;

CREATE OR REPLACE FUNCTION public.guard_trade_messages_paused()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid;
BEGIN
  IF NEW.trade_messages_paused IS NOT DISTINCT FROM OLD.trade_messages_paused THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  BEGIN actor := auth.uid(); EXCEPTION WHEN others THEN actor := NULL; END;
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details)
  VALUES (actor, 'trade_messages_paused_db_change',
    'Pause all trade messages turned ' || CASE WHEN NEW.trade_messages_paused THEN 'on' ELSE 'off' END,
    jsonb_build_object('db_role', current_user, 'application', current_setting('application_name', true),
      'from', OLD.trade_messages_paused, 'to', NEW.trade_messages_paused));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_trade_messages_paused() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_trade_messages_paused ON public.workflow_settings;
CREATE TRIGGER trg_guard_trade_messages_paused
  BEFORE UPDATE OF trade_messages_paused ON public.workflow_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_trade_messages_paused();
