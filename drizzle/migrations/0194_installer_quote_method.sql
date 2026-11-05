-- Photo-quote installers (No Gap, Jo 5 Nov 2026; spec docs/superpowers/specs/2026-11-05-photo-quote-installers-design.md):
-- how an installer quotes Home Insulation Victoria leads — 'ready_check' (a Ready Check visit, the default) or 'photos'
-- (from the owner's photos/videos, no visit). The code treats a missing column as 'ready_check'.
-- APPLIED live 6 Nov 2026 ~08:15 AEDT (Jo OK). Proven on PGlite (tests/installer-quote-method.pglite.test.ts); run live only with Jo's OK.
--
-- Same audit style as installer-business-settings.sql: any change, whatever wrote it, bumps updated_at and writes ONE
-- admin_config_events `quote_method_changed` row. Inserts are not changes. Every statement is idempotent.
alter table public.businesses add column if not exists quote_method text not null default 'ready_check';
alter table public.businesses drop constraint if exists businesses_quote_method_check;
alter table public.businesses add constraint businesses_quote_method_check check (quote_method in ('ready_check', 'photos'));

CREATE OR REPLACE FUNCTION public.guard_quote_method()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid;
BEGIN
  IF NEW.quote_method IS NOT DISTINCT FROM OLD.quote_method THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  BEGIN actor := auth.uid(); EXCEPTION WHEN others THEN actor := NULL; END;
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details)
  VALUES (actor, 'quote_method_changed',
    'How ' || NEW.name || ' quotes: ' || NEW.quote_method || ' (was ' || OLD.quote_method || ')',
    jsonb_build_object('business_id', NEW.id, 'db_role', current_user, 'application', current_setting('application_name', true),
      'from', OLD.quote_method, 'to', NEW.quote_method));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_quote_method() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_quote_method ON public.businesses;
CREATE TRIGGER trg_guard_quote_method
  BEFORE UPDATE OF quote_method ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.guard_quote_method();
