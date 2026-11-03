-- Installer screens Task 9 (new job flow Part 5; Jo 2 Nov 2026): who books the safety check and the upgrades day for an
-- installer business — its office, its electrician, or either (whoever goes first). Part 6 reads it (`whoBooksOf`);
-- the code treats a missing column as 'office'. Default 'office' for every business.
-- Pending: proven on PGlite (tests/installer-business-settings.pglite.test.ts); run live only with Jo's OK.
--
-- Same audit style as trade-messages-paused.sql: any change, whatever wrote it, bumps updated_at and writes ONE
-- admin_config_events `who_books_changed` row. Inserts are not changes.
alter table public.businesses add column if not exists piesa_booked_by text not null default 'office';
alter table public.businesses drop constraint if exists businesses_piesa_booked_by_check;
alter table public.businesses add constraint businesses_piesa_booked_by_check check (piesa_booked_by in ('office', 'electrician', 'either'));

CREATE OR REPLACE FUNCTION public.guard_piesa_booked_by()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid;
BEGIN
  IF NEW.piesa_booked_by IS NOT DISTINCT FROM OLD.piesa_booked_by THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  BEGIN actor := auth.uid(); EXCEPTION WHEN others THEN actor := NULL; END;
  INSERT INTO public.admin_config_events (actor_id, event_type, summary, details)
  VALUES (actor, 'who_books_changed',
    'Who books the safety check for ' || NEW.name || ': ' || NEW.piesa_booked_by || ' (was ' || OLD.piesa_booked_by || ')',
    jsonb_build_object('business_id', NEW.id, 'db_role', current_user, 'application', current_setting('application_name', true),
      'from', OLD.piesa_booked_by, 'to', NEW.piesa_booked_by));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_piesa_booked_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_piesa_booked_by ON public.businesses;
CREATE TRIGGER trg_guard_piesa_booked_by
  BEFORE UPDATE OF piesa_booked_by ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.guard_piesa_booked_by();
