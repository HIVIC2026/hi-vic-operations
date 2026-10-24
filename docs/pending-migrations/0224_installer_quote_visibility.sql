-- 0224_installer_quote_visibility.sql (Jo 24 Oct 2026: on our leads the installer sees quote status only).
-- Installers keep read access to the ACCEPTED installation quote only on their own jobs (channel 'installer_sourced').
-- On our leads (hivic_sourced) the owner price is our fixed price list, so a direct Supabase read would expose our
-- margin; the portal shows those installers the status only (installer-quote-status.functions.ts). Owner, admin and
-- electrician access unchanged. Server code reads quotes with the service role and is unaffected.
-- Proven on PGlite: tests/installer-quote-visibility-db.test.ts. ROLLBACK: 0224_installer_quote_visibility.rollback.sql.
CREATE OR REPLACE FUNCTION public.quote_visible_to_current_user(_job_id uuid, _kind quote_kind, _status quote_status, _release_state text, _sent_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_admin()
      OR (public.is_job_owner(_job_id, auth.uid()) AND public.owner_quote_released(_status, _release_state, _sent_at))
      OR (_kind = 'installation'::public.quote_kind AND _status = 'accepted'::public.quote_status AND public.job_assignment_role(_job_id, auth.uid()) = 'installer'
          AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND j.channel = 'installer_sourced'))
      OR (_kind = 'rectification'::public.quote_kind AND _status <> 'superseded'::public.quote_status AND public.job_assignment_role(_job_id, auth.uid()) = 'electrician')
$function$;
