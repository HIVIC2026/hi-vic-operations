-- Save, save event and queue stage commit together. No delivery calls on this path.
CREATE OR REPLACE FUNCTION public.repair_campaign_spot_stage(p_job uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE j public.jobs;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND OR j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL
   OR j.stage <> 'preliminary_estimate_ready' THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.workflow_events WHERE job_id=p_job AND event_type='campaign_spot_saved')
   OR EXISTS (SELECT 1 FROM public.lead_campaign_responses WHERE job_id=p_job AND opted_out_at IS NOT NULL)
   THEN RETURN false; END IF;
 PERFORM public.commit_guarded_stage(p_job,j.stage,'ready_check_ready_to_schedule',NULL,
   'Repaired interrupted Save my spot: recorded save had not moved the job',
   '{"repaired":true,"reason":"campaign_spot_saved without stage move","no_customer_messages":true}'::jsonb,
   'Assign EEC Certified Insulation Installer and arrange Ready Check');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.repair_campaign_spot_stage(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_campaign_spot_stage(uuid) TO service_role;

-- Also protects the already-published save handler: an inserted save event cannot
-- commit without its stage move. No booking, offer, eligibility or delivery changes.
CREATE OR REPLACE FUNCTION public.campaign_spot_saved_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE j public.jobs;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
 IF j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL OR j.stage IN ('on_hold','cancelled','complete')
   THEN RAISE EXCEPTION 'This enquiry is no longer active.'; END IF;
 IF EXISTS (SELECT 1 FROM public.lead_campaign_responses WHERE job_id=NEW.job_id AND opted_out_at IS NOT NULL)
   THEN RAISE EXCEPTION 'This enquiry has already been taken off the list.'; END IF;
 IF j.stage IN ('new_enquiry','eligibility_review') THEN
   PERFORM public.commit_guarded_stage(j.id,j.stage,'preliminary_estimate_ready',NULL,
     'Owner saved their spot – preliminary queue qualification; final onsite verification required','{}'::jsonb,
     'Owner to book Home Insulation Ready Check');
   j.stage := 'preliminary_estimate_ready';
 END IF;
 IF j.stage='preliminary_estimate_ready' THEN
   PERFORM public.commit_guarded_stage(j.id,j.stage,'ready_check_ready_to_schedule',NULL,
     'Owner saved their spot – free Ready Check next','{}'::jsonb,
     'Assign EEC Certified Insulation Installer and arrange Ready Check');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campaign_spot_saved_stage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_spot_saved_stage() TO service_role;
CREATE OR REPLACE TRIGGER campaign_spot_saved_stage
 AFTER INSERT ON public.workflow_events FOR EACH ROW
 WHEN (NEW.event_type='campaign_spot_saved') EXECUTE FUNCTION public.campaign_spot_saved_stage();

CREATE OR REPLACE FUNCTION public.save_campaign_spot_atomic(p_job uuid,p_link uuid,p_snapshot jsonb,p_onsite boolean,p_summary text,p_details jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE j public.jobs; r public.lead_campaign_responses; first_save boolean;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND OR j.deleted_at IS NOT NULL OR j.qa_archived_at IS NOT NULL OR j.stage IN ('on_hold','cancelled','complete')
   THEN RAISE EXCEPTION 'This enquiry is no longer active.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customer_estimate_links WHERE id=p_link AND job_id=p_job)
   THEN RAISE EXCEPTION 'This link is no longer available.'; END IF;
 SELECT * INTO r FROM public.lead_campaign_responses WHERE job_id=p_job FOR UPDATE;
 IF r.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'This enquiry has already been taken off the list.'; END IF;
 first_save := r.spot_saved_at IS NULL;
 IF first_save THEN
   IF j.stage NOT IN ('new_enquiry','eligibility_review','preliminary_estimate_ready','ready_check_ready_to_schedule')
     THEN RAISE EXCEPTION 'This enquiry has already moved on.'; END IF;
   INSERT INTO public.lead_campaign_responses(job_id,estimate_link_id,spot_saved_at,video_requested,desk_check_status,
     saved_estimate_id,saved_total,saved_veu_discount,saved_gross_total,saved_area_m2,saved_insulation,saved_estimate_url)
   VALUES(p_job,p_link,now(),p_onsite,CASE WHEN p_onsite THEN 'pending' ELSE 'not_needed' END,
     (p_snapshot->>'saved_estimate_id')::uuid,(p_snapshot->>'saved_total')::numeric,
     (p_snapshot->>'saved_veu_discount')::numeric,(p_snapshot->>'saved_gross_total')::numeric,
     (p_snapshot->>'saved_area_m2')::numeric,p_snapshot->>'saved_insulation',p_snapshot->>'saved_estimate_url')
   ON CONFLICT(job_id) DO UPDATE SET spot_saved_at=EXCLUDED.spot_saved_at,updated_at=now(),
     saved_estimate_id=EXCLUDED.saved_estimate_id,saved_total=EXCLUDED.saved_total,
     saved_veu_discount=EXCLUDED.saved_veu_discount,saved_gross_total=EXCLUDED.saved_gross_total,
     saved_area_m2=EXCLUDED.saved_area_m2,saved_insulation=EXCLUDED.saved_insulation,saved_estimate_url=EXCLUDED.saved_estimate_url;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workflow_events WHERE job_id=p_job AND event_type='campaign_spot_saved') THEN
   INSERT INTO public.workflow_events(job_id,event_type,summary,details,internal)
     VALUES(p_job,'campaign_spot_saved',p_summary,coalesce(p_details,'{}'::jsonb),true);
 ELSE
   PERFORM public.repair_campaign_spot_stage(p_job);
 END IF;
 RETURN first_save;
END $$;
REVOKE ALL ON FUNCTION public.save_campaign_spot_atomic(uuid,uuid,jsonb,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_campaign_spot_atomic(uuid,uuid,jsonb,boolean,text,jsonb) TO service_role;