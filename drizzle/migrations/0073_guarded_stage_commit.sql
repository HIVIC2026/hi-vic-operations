-- Called ONLY after workflow.server.ts stageEntryBlockers. Not an alternative rule engine.
-- Browser JWTs, including admin JWTs, cannot directly mutate jobs. Admin writes use server functions.
REVOKE INSERT,UPDATE,DELETE ON public.jobs FROM anon,authenticated;
CREATE FUNCTION public.commit_guarded_stage(_job uuid,_expected public.job_stage,_to public.job_stage,_actor uuid,_summary text,_details jsonb,_next text,_disposition text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.jobs;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 IF j.stage<>_expected THEN RAISE EXCEPTION 'Job changed concurrently; reload and re-evaluate blockers'; END IF;
 IF j.stage=_to THEN RETURN false; END IF;
 IF j.stage IN ('cancelled','complete') THEN RAISE EXCEPTION 'Terminal job cannot progress'; END IF;
 IF length(trim(_summary))=0 THEN RAISE EXCEPTION 'Audit summary required'; END IF;
 IF _disposition IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _disposition='resume' AND (j.stage<>'on_hold' OR j.prior_stage IS DISTINCT FROM _to) THEN RAISE EXCEPTION 'Invalid resume'; END IF;
  IF _disposition='hold' AND _to<>'on_hold' THEN RAISE EXCEPTION 'Invalid hold'; END IF;
  IF _disposition='cancel' AND _to<>'cancelled' THEN RAISE EXCEPTION 'Invalid cancel'; END IF;
  IF _disposition NOT IN ('resume','hold','cancel') THEN RAISE EXCEPTION 'Invalid disposition'; END IF;
 ELSIF j.stage='on_hold' OR _to IN ('on_hold','cancelled') THEN RAISE EXCEPTION 'Use reviewed disposition'; END IF;
 UPDATE public.jobs SET stage=_to,next_action=_next,last_activity_at=now(),
  prior_stage=CASE WHEN _disposition='resume' THEN NULL WHEN _disposition IN ('hold','cancel') THEN CASE WHEN j.stage='on_hold' THEN j.prior_stage ELSE j.stage END ELSE j.prior_stage END,
  hold_reason=CASE WHEN _disposition='hold' THEN _summary WHEN _disposition IS NOT NULL THEN NULL ELSE j.hold_reason END,
  cancelled_reason=CASE WHEN _disposition='cancel' THEN _summary ELSE j.cancelled_reason END
  WHERE id=_job;
 INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,from_stage,to_stage,internal)
 VALUES(_job,_actor,'stage_changed',_summary,coalesce(_details,'{}'::jsonb),_expected,_to,false);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.commit_guarded_stage(uuid,public.job_stage,public.job_stage,uuid,text,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_guarded_stage(uuid,public.job_stage,public.job_stage,uuid,text,jsonb,text,text) TO service_role;