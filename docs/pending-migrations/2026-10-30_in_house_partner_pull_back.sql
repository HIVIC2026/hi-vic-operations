-- PENDING ONLY. No bookings, job stages, payments, forms or messages are changed.
-- Service-only transaction; caller checks admin and binds actor. SQL validates persisted roles too.
CREATE OR REPLACE FUNCTION public.pull_back_in_house_job(_job uuid, _reason text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE installer_business uuid; assignment_ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='admin')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role::text='qa_office') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF _reason IS NULL OR length(trim(_reason))=0 THEN RAISE EXCEPTION 'Reason required'; END IF;
  PERFORM 1 FROM public.jobs WHERE id=_job AND deleted_at IS NULL AND source<>'qa_test' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable'; END IF;
  SELECT a.business_id INTO installer_business FROM public.job_assignments a
    JOIN public.businesses b ON b.id=a.business_id
    WHERE a.job_id=_job AND a.active AND a.role::text='installer' AND b.in_house
    FOR UPDATE OF a FOR SHARE OF b;
  -- A replay after successful pull-back is inert, including its audit.
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.workflow_events WHERE job_id=_job AND event_type='in_house_pulled_back') THEN RETURN; END IF;
    RAISE EXCEPTION 'Job is not held by an in-house partner';
  END IF;
  WITH ended AS (
    UPDATE public.job_assignments SET active=false,ended_at=now(),end_reason='pulled_back'
    WHERE job_id=_job AND active AND business_id=installer_business AND role::text IN ('installer','electrician') RETURNING id
  ) SELECT array_agg(id ORDER BY id) INTO assignment_ids FROM ended;
  INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
    VALUES (_job,_actor,'in_house_pulled_back','Job taken back from in-house partner: ' || trim(_reason),
      jsonb_build_object('reason',trim(_reason),'business_id',installer_business,'assignment_ids',assignment_ids),true);
END $$;
REVOKE ALL ON FUNCTION public.pull_back_in_house_job(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pull_back_in_house_job(uuid,text,uuid) TO service_role;