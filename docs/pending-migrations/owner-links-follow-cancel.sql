-- Owner links stay working (Jo 1 Nov 2026): an owner's link works until their job is cancelled. No time limit.
-- Spec: docs/superpowers/specs/2026-11-01-owner-links-stay-working-design.md
-- Pending: proven on PGlite (tests/owner-links-follow-cancel.pglite.test.ts); run live only with Jo's OK.
--
-- 1. Trigger on jobs: stage -> cancelled revokes the job's active links (reason 'job_cancelled');
--    stage leaves cancelled -> those same links (same token) become active again, so the owner's old emails work.
--    Links revoked for any other reason (e.g. Gate 1) are never restored. A trigger, because 7 code paths cancel jobs.
-- 2. save_owner_insulation_details (the 3 questions on the photo page) no longer requires expires_at > now().

CREATE OR REPLACE FUNCTION public.owner_links_follow_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage::text = 'cancelled' THEN
    UPDATE public.customer_estimate_links
       SET status = 'revoked', revoked_at = now(), revocation_reason = 'job_cancelled'
     WHERE job_id = NEW.id AND status = 'active';
  ELSIF OLD.stage::text = 'cancelled' THEN
    -- One active link per job + purpose (customer_estimate_links_one_active): restore the newest per purpose,
    -- and only where the job has no active link of that purpose already.
    UPDATE public.customer_estimate_links l
       SET status = 'active', revoked_at = NULL, revocation_reason = NULL
     WHERE l.id IN (
       SELECT DISTINCT ON (r.purpose) r.id
         FROM public.customer_estimate_links r
        WHERE r.job_id = NEW.id AND r.status = 'revoked' AND r.revocation_reason = 'job_cancelled'
          AND NOT EXISTS (SELECT 1 FROM public.customer_estimate_links a
                           WHERE a.job_id = r.job_id AND a.purpose = r.purpose AND a.status = 'active')
        ORDER BY r.purpose, r.revoked_at DESC NULLS LAST, r.created_at DESC);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.owner_links_follow_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_owner_links_follow_cancel ON public.jobs;
CREATE TRIGGER trg_owner_links_follow_cancel
  AFTER UPDATE OF stage ON public.jobs
  FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.owner_links_follow_cancel();

-- Same function as live (checked 1 Nov 2026) with only "AND expires_at>now()" removed from the link lookup.
CREATE OR REPLACE FUNCTION public.save_owner_insulation_details(p_token text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j public.jobs%ROWTYPE; l public.customer_estimate_links%ROWTYPE; route text; old jsonb;
BEGIN
 IF p_answers->>'insulation_type' NOT IN ('loose_fill','batts','unknown') OR p_answers->>'insulation_thickness' NOT IN ('thin','hand','thicker','unknown') OR p_answers->>'house_built_period' NOT IN ('1990_or_earlier','1991_1999','2000_2009','2010_2020','last_5_years','unknown') OR NOT p_answers ?& ARRAY['insulation_type','insulation_thickness','house_built_period'] THEN RAISE EXCEPTION 'Invalid answers'; END IF;
 SELECT * INTO l FROM customer_estimate_links WHERE token=p_token AND purpose='step3_estimate' AND status='active';
 IF l.id IS NULL THEN RAISE EXCEPTION 'Link unavailable'; END IF;
 SELECT * INTO j FROM jobs WHERE id=l.job_id FOR UPDATE;
 IF j.source NOT IN ('base44','qa_test') OR j.stage NOT IN ('new_enquiry','eligibility_review','preliminary_estimate_ready','ready_check_ready_to_schedule') OR j.eligibility_review_required OR j.eligibility_outcome NOT IN ('likely_eligible','needs_onsite_confirmation') THEN RAISE EXCEPTION 'Job unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM owner_contact_consents WHERE job_id=j.id AND consent_status='granted' AND created_at=(SELECT max(created_at) FROM owner_contact_consents WHERE job_id=j.id)) OR EXISTS(SELECT 1 FROM customer_email_optouts WHERE job_id=j.id AND opted_out_at IS NOT NULL) THEN RAISE EXCEPTION 'Consent unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM lead_campaign_responses WHERE job_id=j.id AND (opted_out_at IS NOT NULL OR spot_saved_at IS NOT NULL OR desk_checked_at IS NOT NULL)) THEN RAISE EXCEPTION 'Existing response cannot change'; END IF;
 SELECT enrichment->'owner_insulation_details' INTO old FROM properties WHERE id=j.property_id FOR UPDATE;
 -- Jo 23 Oct 08:27 UTC: owners with photos may answer too; they get Save my spot and the office checks photos later.
 -- House age (1990 or earlier — Victoria's 1991
 -- minimum standards, Sustainability Victoria 2016) only affects the Spots saved rank.
 route=CASE WHEN p_answers->>'house_built_period'='last_5_years' THEN 'ineligible' WHEN p_answers->>'insulation_type'='loose_fill' OR p_answers->>'insulation_thickness'='thin' THEN 'thin_patchy' ELSE 'existing_save_spot' END;
 IF old->'answers'=p_answers THEN RETURN jsonb_build_object('route',route,'repeated',true); END IF;
 UPDATE properties SET enrichment=coalesce(enrichment,'{}')||jsonb_build_object('owner_insulation_details',jsonb_build_object('answers',p_answers,'route',route,'basis','owner_declared','answered_at',now())) WHERE id=j.property_id;
 INSERT INTO workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(j.id,NULL,'owner_insulation_details_answered',CASE WHEN route='thin_patchy' THEN 'Owner insulation details: likely below R2 (declared type, thickness or house age)' ELSE 'Owner insulation details answered: existing insulation (standard Save my spot)' END,jsonb_build_object('answers',p_answers,'route',route,'basis','owner_declared','previous',old),true);
 IF route='ineligible' THEN
   UPDATE public.jobs SET eligibility_outcome='does_not_appear_eligible', eligibility_set_at=now(), next_action='Home built in the last 5 years — does not qualify under the five-year rule' WHERE id=j.id;
   INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(j.id,NULL,'owner_build_age_ineligible','Owner declared home built in the last 5 years — five-year rule',jsonb_build_object('build_decade','last_5_years','property_over_five_years','no','basis','owner_declared'),true);
   RETURN jsonb_build_object('route',route,'repeated',false);
 END IF;
 IF route IN ('thin_patchy','existing_save_spot') THEN
 INSERT INTO workflow_events(job_id,actor_id,event_type,summary,details,internal) VALUES(j.id,NULL,'owner_insulation_present_auto_offer','Owner-declared likely below R2 (type, thickness or house age); final onsite checks apply',jsonb_build_object('answer','yes','preliminary_queue_qualification',true,'basis','owner_declared','declaration_type','present_auto_offer'),true);
 END IF;
 INSERT INTO lead_campaign_responses(job_id,estimate_link_id,campaign,desk_check_status,desk_check_reason) VALUES(j.id,l.id,'existing_leads_launch_v1','not_needed',CASE WHEN route='thin_patchy' THEN 'Owner-declared thin/loose-fill' ELSE 'Owner-declared existing insulation' END) ON CONFLICT(job_id) DO UPDATE SET desk_check_status=EXCLUDED.desk_check_status,desk_check_reason=EXCLUDED.desk_check_reason,updated_at=now() WHERE lead_campaign_responses.desk_checked_at IS NULL AND lead_campaign_responses.opted_out_at IS NULL AND lead_campaign_responses.spot_saved_at IS NULL;
  RETURN jsonb_build_object('route',route,'repeated',false);
END $function$;
