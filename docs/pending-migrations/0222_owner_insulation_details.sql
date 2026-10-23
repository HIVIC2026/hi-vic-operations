-- Function part APPLIED live 24 Oct 2026 (Jo: "Fix the saving"), proven on PGlite first. The view below is NOT applied.
CREATE OR REPLACE FUNCTION public.save_owner_insulation_details(p_token text,p_answers jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.jobs%ROWTYPE; l public.customer_estimate_links%ROWTYPE; route text; old jsonb;
BEGIN
 IF p_answers->>'insulation_type' NOT IN ('loose_fill','batts','unknown') OR p_answers->>'insulation_thickness' NOT IN ('thin','hand','thicker','unknown') OR p_answers->>'house_built_period' NOT IN ('1990_or_earlier','1991_1999','2000_2009','2010_2020','last_5_years','unknown') OR NOT p_answers ?& ARRAY['insulation_type','insulation_thickness','house_built_period'] THEN RAISE EXCEPTION 'Invalid answers'; END IF;
 SELECT * INTO l FROM customer_estimate_links WHERE token=p_token AND purpose='step3_estimate' AND status='active' AND expires_at>now();
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
END $$;
REVOKE ALL ON FUNCTION public.save_owner_insulation_details(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_owner_insulation_details(text,jsonb) TO service_role;

-- Exclude onsite-only answers from every operational list; new media returns to normal review.
CREATE OR REPLACE VIEW public.office_enquiry_index AS
WITH base AS (
         SELECT j.id,
            j.job_number,
            j.external_enquiry_id,
            j.stage::text AS stage,
            j.source,
            j.channel::text AS channel,
            j.created_at,
            j.eligibility_set_at,
            j.eligibility_outcome::text AS eligibility_outcome,
            j.deleted_at,
            j.qa_archived_at,
            o.full_name AS owner_name,
            o.email AS owner_email,
            o.phone AS owner_phone,
            concat_ws(', '::text, p.address_line, p.suburb, p.state, p.postcode) AS property_address,
            lower(TRIM(BOTH FROM o.email)) AS email_key,
            (COALESCE(TRIM(BOTH FROM p.postcode), ''::text) || '|'::text) || TRIM(BOTH FROM regexp_replace(regexp_replace(lower(COALESCE(p.address_line, ''::text)), '\m(vic|victoria)\M'::text, ''::text, 'g'::text), '[^a-z0-9]+'::text, ' '::text, 'g'::text)) AS property_key,
            (EXISTS ( SELECT 1
                   FROM workflow_events e
                  WHERE e.job_id = j.id AND e.event_type = 'lead_removed'::text)) AS removed,
            (EXISTS ( SELECT 1
                   FROM customer_email_sends s
                  WHERE s.job_id = j.id AND (s.status = ANY (ARRAY['sent'::text, 'delivered'::text])))) AS first_response_sent,
            (EXISTS ( SELECT 1
                   FROM customer_email_sends s
                  WHERE s.job_id = j.id AND s.status = 'sent'::text AND (s.purpose = 'insulation_video_request'::text OR s.purpose = 'existing_leads_launch_v1'::text AND (s.idempotency_key ~~ '%:insulation_details:%'::text OR s.idempotency_key ~ ':b(:|$)'::text)))) AS photos_requested,
            (EXISTS ( SELECT 1
                   FROM customer_email_sends s
                  WHERE s.job_id = j.id AND s.status = 'sent'::text AND (s.purpose = 'step3_estimate'::text OR s.purpose = 'existing_leads_launch_v1'::text AND s.idempotency_key !~~ '%:insulation_details:%'::text AND s.idempotency_key !~ ':b(:|$)'::text))) AS spot_offered,
            (EXISTS ( SELECT 1
                   FROM lead_campaign_responses r
                  WHERE r.job_id = j.id AND r.spot_saved_at IS NOT NULL AND r.opted_out_at IS NULL)) AS spot_saved,
            ( SELECT e.metadata ->> 'outcome'::text
                   FROM customer_engagement_events e
                  WHERE e.job_id = j.id AND e.event_type = 'intake_media_reviewed'::text AND e.source = 'office'::text
                  ORDER BY e.occurred_at DESC, e.id DESC
                 LIMIT 1) AS review_outcome,
            ( SELECT count(*) AS count
                   FROM ( SELECT d.storage_path
                           FROM documents d
                          WHERE d.job_id = j.id AND d.kind = 'intake_media'::text
                        UNION
                         SELECT e.storage_path
                           FROM evidence_files e
                          WHERE e.job_id = j.id AND e.storage_path ~~ (j.id::text || '/intake/%'::text)) m) AS media_count,
            (EXISTS ( SELECT 1
                   FROM ready_check_acceptances a
                  WHERE a.job_id = j.id)) OR (EXISTS ( SELECT 1
                   FROM ready_check_windows w
                  WHERE w.job_id = j.id AND w.status <> 'cancelled'::text)) OR (EXISTS ( SELECT 1
                   FROM bookings b
                  WHERE b.job_id = j.id AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'completed'::booking_status])))) OR (EXISTS ( SELECT 1
                   FROM quotes q
                  WHERE q.job_id = j.id AND q.status = 'accepted'::quote_status)) AS owner_progressed,
            (EXISTS ( SELECT 1
                   FROM job_communications c
                  WHERE c.job_id = j.id AND c.direction = 'outbound'::text AND c.channel = 'email'::text AND c.visibility = 'customer'::text)) AS correspondence_recorded,
            (EXISTS ( SELECT 1
                   FROM customer_email_sends s
                  WHERE s.job_id = j.id AND (s.status = ANY (ARRAY['sending'::text, 'queued'::text, 'delivered_unrecorded'::text, 'sending_unknown'::text])))) AS response_uncertain,
            ( SELECT s.status
                   FROM customer_email_sends s
                  WHERE s.job_id = j.id
                  ORDER BY s.created_at DESC, s.id DESC
                 LIMIT 1) AS latest_attempt_status,
            ( SELECT s.created_at
                   FROM customer_email_sends s
                  WHERE s.job_id = j.id
                  ORDER BY s.created_at DESC, s.id DESC
                 LIMIT 1) AS latest_attempt_at,
            ( SELECT e.occurred_at
                   FROM customer_engagement_events e
                  WHERE e.job_id = j.id AND e.event_type = 'intake_media_reviewed'::text AND e.source = 'office'::text
                  ORDER BY e.occurred_at DESC, e.id DESC
                 LIMIT 1) AS review_at,
            ( SELECT e.id FROM customer_engagement_events e
                WHERE e.job_id = j.id AND e.event_type = 'intake_media_reviewed' AND e.source = 'office'
                ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS review_id,
            GREATEST(( SELECT max(d.created_at) AS max
                   FROM documents d
                  WHERE d.job_id = j.id AND d.kind = 'intake_media'::text), ( SELECT max(e.uploaded_at) AS max
                   FROM evidence_files e
                  WHERE e.job_id = j.id AND e.storage_path ~~ (j.id::text || '/intake/%'::text))) AS latest_media_at
           FROM jobs j
             LEFT JOIN owners o ON o.id = j.owner_id
             LEFT JOIN properties p ON p.id = j.property_id
        ), requested AS (
          SELECT base.*, GREATEST(
            (SELECT max(s.sent_at) FROM customer_email_sends s
             WHERE s.job_id = base.id AND s.status IN ('sent', 'delivered')
               AND s.purpose = 'insulation_video_request'
               AND s.idempotency_key = 'office_more_photos:' || base.id::text || ':' || base.review_id::text
               AND s.sent_at > base.review_at),
            (SELECT max(c.sent_at) FROM job_communications c
             WHERE c.job_id = base.id AND c.direction = 'outbound' AND c.channel = 'email' AND c.visibility = 'customer'
               AND c.source_event = 'office_more_photos_requested'
               AND c.source_reference = 'intake_media_review:' || base.review_id::text
               AND c.delivery_status IN ('recorded', 'sent', 'delivered')
               AND c.sent_at > base.review_at)
          ) AS more_photos_requested_at FROM base
        ), ranked AS (
         SELECT base.id,
            base.job_number,
            base.external_enquiry_id,
            base.stage,
            base.source,
            base.channel,
            base.created_at,
            base.eligibility_set_at,
            base.eligibility_outcome,
            base.deleted_at,
            base.qa_archived_at,
            base.owner_name,
            base.owner_email,
            base.owner_phone,
            base.property_address,
            base.email_key,
            base.property_key,
            base.removed,
            base.first_response_sent,
            base.photos_requested,
            base.spot_offered,
            base.spot_saved,
            base.review_outcome,
            base.media_count,
            base.owner_progressed,
            base.correspondence_recorded,
            base.response_uncertain,
            base.latest_attempt_status,
            base.latest_attempt_at,
            base.review_at,
            base.latest_media_at,
            base.more_photos_requested_at,
                CASE
                    WHEN base.email_key IS NULL OR base.email_key = ''::text THEN 1::bigint
                    ELSE row_number() OVER (PARTITION BY base.source, base.channel, base.email_key, base.property_key ORDER BY base.created_at DESC, base.id DESC)
                END AS contact_rank
           FROM requested base
        ), classified AS (
         SELECT ranked.id,
            ranked.job_number,
            ranked.external_enquiry_id,
            ranked.stage,
            ranked.source,
            ranked.channel,
            ranked.created_at,
            ranked.eligibility_set_at,
            ranked.eligibility_outcome,
            ranked.deleted_at,
            ranked.qa_archived_at,
            ranked.owner_name,
            ranked.owner_email,
            ranked.owner_phone,
            ranked.property_address,
            ranked.email_key,
            ranked.property_key,
            ranked.removed,
            ranked.first_response_sent,
            ranked.photos_requested,
            ranked.spot_offered,
            ranked.spot_saved,
            ranked.review_outcome,
            ranked.media_count,
            ranked.owner_progressed,
            ranked.correspondence_recorded,
            ranked.response_uncertain,
            ranked.latest_attempt_status,
            ranked.latest_attempt_at,
            ranked.review_at,
            ranked.latest_media_at,
            ranked.more_photos_requested_at,
            ranked.contact_rank,
                CASE
                    WHEN ranked.deleted_at IS NOT NULL OR ranked.removed OR ranked.qa_archived_at IS NOT NULL OR ranked.source = 'qa_test'::text OR ranked.contact_rank > 1 OR (ranked.job_number = ANY (ARRAY['HV-1059'::text, 'HV-1061'::text, 'HV-1063'::text, 'HV-1257'::text, 'HV-1291'::text, 'HV-1161'::text, 'HV-1437'::text, 'HV-1225'::text, 'HV-1242'::text, 'HV-1286'::text, 'HV-1475'::text, 'HV-1180'::text])) OR (ranked.stage = ANY (ARRAY['cancelled'::text, 'complete'::text])) OR ranked.eligibility_outcome = 'does_not_appear_eligible'::text OR ranked.review_outcome = 'over_r2'::text THEN 'closed'::text
                    WHEN ranked.spot_saved OR ranked.owner_progressed OR ranked.channel = 'installer_sourced'::text OR (ranked.stage <> ALL (ARRAY['new_enquiry'::text, 'eligibility_review'::text, 'preliminary_estimate_ready'::text, 'on_hold'::text, 'ready_check_awaiting_acceptance'::text, 'ready_check_awaiting_payment'::text, 'ready_check_ready_to_schedule'::text])) THEN 'active'::text
                    ELSE 'enquiry'::text
                END AS office_bucket,
                CASE
                    WHEN ranked.spot_saved THEN 'spot_saved'::text
                    WHEN ranked.eligibility_outcome = 'does_not_appear_eligible'::text OR ranked.review_outcome = 'over_r2'::text THEN 'ineligible'::text
                    WHEN ranked.review_outcome = 'unclear' THEN CASE WHEN ranked.more_photos_requested_at IS NOT NULL AND (ranked.latest_media_at IS NULL OR ranked.latest_media_at <= ranked.review_at) THEN 'insulation_requested'::text ELSE 'needs_attention'::text END
                    WHEN ranked.spot_offered THEN 'offered_spot'::text
                    WHEN ranked.photos_requested THEN 'insulation_requested'::text
                    ELSE 'needs_attention'::text
                END AS enquiry_status
           FROM ranked
        )
 SELECT id,
    job_number,
    external_enquiry_id,
    stage,
    source,
    channel,
    created_at,
    eligibility_set_at,
    eligibility_outcome,
    deleted_at,
    qa_archived_at,
    owner_name,
    owner_email,
    owner_phone,
    property_address,
    email_key,
    property_key,
    removed,
    first_response_sent,
    photos_requested,
    spot_offered,
    spot_saved,
    review_outcome,
    media_count,
    owner_progressed,
    contact_rank,
    office_bucket,
    enquiry_status,
    NOT first_response_sent AND NOT correspondence_recorded AND NOT response_uncertain AS needs_first_response,
    media_count > 0 AND (review_outcome IS NULL OR (review_outcome <> ALL (ARRAY['no_insulation'::text, 'below_r2'::text, 'over_r2'::text, 'unclear'::text])) OR review_outcome = 'unclear'::text AND latest_media_at IS NOT NULL AND review_at IS NOT NULL AND latest_media_at > review_at) AS media_to_review,
    correspondence_recorded,
    response_uncertain,
    latest_attempt_status,
    latest_attempt_at,
    review_at,
    latest_media_at,
        CASE
            WHEN first_response_sent THEN 'provider_confirmed'::text
            WHEN correspondence_recorded THEN 'recorded_only'::text
            WHEN response_uncertain THEN 'uncertain'::text
            ELSE 'none'::text
        END AS response_state,
    more_photos_requested_at,
    review_outcome = 'unclear' AND more_photos_requested_at IS NOT NULL
      AND (latest_media_at IS NULL OR latest_media_at <= review_at) AS more_photos_requested
   FROM classified;

