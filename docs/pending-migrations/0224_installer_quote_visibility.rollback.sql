-- Rollback for 0224: restores the live definition read on 24 Oct 2026 (installers see accepted installation quotes on any job).
CREATE OR REPLACE FUNCTION public.quote_visible_to_current_user(_job_id uuid, _kind quote_kind, _status quote_status, _release_state text, _sent_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_admin()
      OR (public.is_job_owner(_job_id, auth.uid()) AND public.owner_quote_released(_status, _release_state, _sent_at))
      OR (_kind = 'installation'::public.quote_kind AND _status = 'accepted'::public.quote_status AND public.job_assignment_role(_job_id, auth.uid()) = 'installer')
      OR (_kind = 'rectification'::public.quote_kind AND _status <> 'superseded'::public.quote_status AND public.job_assignment_role(_job_id, auth.uid()) = 'electrician')
$function$;
