-- 0208: one open-website-enquiry response scope for Enquiries + Communications (Jo, 20 Oct 2026).
-- * first_response_sent = ANY own-job customer send confirmed by the provider (sent/delivered), any purpose.
-- * correspondence_recorded = customer-visible outbound email recorded on the job (a recorded reply, NOT proof of delivery).
-- * response_uncertain = an attempt still sending/queued or with an unknown provider outcome (never resent).
-- * needs_first_response = none of the above. response_state names which one applies (mutually exclusive).
-- * media_to_review also re-opens when new homeowner media arrives after an "unclear" (more photos) review.
-- Columns are appended only; existing column names/types/order are unchanged. ACLs are preserved by CREATE OR REPLACE.
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
            GREATEST(( SELECT max(d.created_at) AS max
                   FROM documents d
                  WHERE d.job_id = j.id AND d.kind = 'intake_media'::text), ( SELECT max(e.uploaded_at) AS max
                   FROM evidence_files e
                  WHERE e.job_id = j.id AND e.storage_path ~~ (j.id::text || '/intake/%'::text))) AS latest_media_at
           FROM jobs j
             LEFT JOIN owners o ON o.id = j.owner_id
             LEFT JOIN properties p ON p.id = j.property_id
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
                CASE
                    WHEN base.email_key IS NULL OR base.email_key = ''::text THEN 1::bigint
                    ELSE row_number() OVER (PARTITION BY base.source, base.channel, base.email_key, base.property_key ORDER BY base.created_at DESC, base.id DESC)
                END AS contact_rank
           FROM base
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
            ranked.contact_rank,
                CASE
                    WHEN ranked.deleted_at IS NOT NULL OR ranked.removed OR ranked.qa_archived_at IS NOT NULL OR ranked.source = 'qa_test'::text OR ranked.contact_rank > 1 OR (ranked.job_number = ANY (ARRAY['HV-1059'::text, 'HV-1061'::text, 'HV-1063'::text, 'HV-1257'::text, 'HV-1291'::text, 'HV-1161'::text, 'HV-1437'::text, 'HV-1225'::text, 'HV-1242'::text, 'HV-1286'::text, 'HV-1475'::text, 'HV-1180'::text])) OR (ranked.stage = ANY (ARRAY['cancelled'::text, 'complete'::text])) OR ranked.eligibility_outcome = 'does_not_appear_eligible'::text OR ranked.review_outcome = 'over_r2'::text THEN 'closed'::text
                    WHEN ranked.spot_saved OR ranked.owner_progressed OR ranked.channel = 'installer_sourced'::text OR (ranked.stage <> ALL (ARRAY['new_enquiry'::text, 'eligibility_review'::text, 'preliminary_estimate_ready'::text, 'on_hold'::text, 'ready_check_awaiting_acceptance'::text, 'ready_check_awaiting_payment'::text, 'ready_check_ready_to_schedule'::text])) THEN 'active'::text
                    ELSE 'enquiry'::text
                END AS office_bucket,
                CASE
                    WHEN ranked.spot_saved THEN 'spot_saved'::text
                    WHEN ranked.eligibility_outcome = 'does_not_appear_eligible'::text OR ranked.review_outcome = 'over_r2'::text THEN 'ineligible'::text
                    WHEN ranked.spot_offered THEN 'offered_spot'::text
                    WHEN ranked.photos_requested OR ranked.review_outcome = 'unclear'::text THEN 'insulation_requested'::text
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
        END AS response_state
   FROM classified;

CREATE OR REPLACE FUNCTION public.office_enquiry_page(p_view text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 WITH scope AS (
 SELECT * FROM public.office_enquiry_index WHERE source='base44' AND channel='hivic_sourced' AND
 (p_search='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(lower(trim(p_search)), '\s+') term WHERE term<>'' AND strpos(lower(concat_ws(' ',owner_name,owner_email,owner_phone,property_address,job_number,external_enquiry_id)),term)>0))
 ), filtered AS (
 SELECT * FROM scope WHERE CASE p_view
 WHEN 'removed' THEN office_bucket='closed' AND (removed OR deleted_at IS NOT NULL OR source='qa_test' OR contact_rank>1)
 WHEN 'ineligible' THEN office_bucket='closed' AND enquiry_status='ineligible' AND NOT removed AND deleted_at IS NULL
 WHEN 'spot_saved' THEN office_bucket='active' AND spot_saved
 WHEN 'all' THEN office_bucket='enquiry'
 WHEN 'new' THEN office_bucket='enquiry' AND needs_first_response
 WHEN 'photos' THEN office_bucket='enquiry' AND media_to_review
 ELSE office_bucket='enquiry' AND enquiry_status=p_view END
 ), n AS (SELECT count(*) AS total FROM filtered), paging AS (
 SELECT greatest(1,least(greatest(1,p_page),greatest(1,ceil(total/50.0)::integer))) AS page,total FROM n
 ), page_rows AS (SELECT f.* FROM filtered f ORDER BY created_at DESC,id ASC LIMIT 50 OFFSET (SELECT (page-1)*50 FROM paging))
 SELECT jsonb_build_object('ids',coalesce((SELECT jsonb_agg(id ORDER BY created_at DESC,id ASC) FROM page_rows),'[]'::jsonb),'total',paging.total,'page',paging.page,'pageSize',50,'totalPages',greatest(1,ceil(paging.total/50.0)::integer),
 'counts',jsonb_build_object('all',(SELECT count(*) FROM scope WHERE office_bucket='enquiry'),'new',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND needs_first_response),'photos',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND media_to_review),'needs_attention',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='needs_attention'),'offered_spot',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='offered_spot'),'insulation_requested',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND enquiry_status='insulation_requested'),'spot_saved',(SELECT count(*) FROM scope WHERE office_bucket='active' AND spot_saved),'ineligible',(SELECT count(*) FROM scope WHERE office_bucket='closed' AND enquiry_status='ineligible' AND NOT removed AND deleted_at IS NULL),'removed',(SELECT count(*) FROM scope WHERE office_bucket='closed' AND (removed OR deleted_at IS NOT NULL OR contact_rank>1))),
  'responses',jsonb_build_object('provider_confirmed',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='provider_confirmed'),'recorded_only',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='recorded_only'),'uncertain',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='uncertain'),'unanswered',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='none'),'unanswered_latest_failed',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND response_state='none' AND latest_attempt_status='failed'))) FROM paging;
$function$;
