-- ===================================================================================================
-- T6 BACKLOG — STEP 1 of 4 — READ ONLY. Sends nothing. Changes nothing.
-- Run this in the Supabase SQL Editor and keep the result: it is the per-candidate answer to
-- "which of the outstanding T6 candidates can go through sendAutomaticInsulationDetails()?".
--
-- WHY THIS SHAPE:
--   * The only code path that renders Jo's T6 copy and sends it is
--       maybeAutoRouteLeadEmail(jobId) -> sendAutomaticInsulationDetails(jobId)
--     -> sendOne(..., { group: "onsite", automaticInsulation: true }) -> renderJoOutcomeEmail()
--     -> template "potentially_eligible_unknown_size_known" (T6).
--   * sendOne() re-checks every gate at send time. This query only predicts what it will decide,
--     using the same inputs, so the office knows the size of the batch BEFORE anything is queued.
--   * "T6-shaped universe" below = website homeowner enquiry, official Gate 1 result recorded,
--     outcome likely_eligible OR needs_onsite_confirmation, insulation present/unknown, and a
--     CURRENT indicative estimate whose area is NOT the typical 150 m2 default (a typical-default
--     area renders T5, not T6).
-- ===================================================================================================

with settings as (
  select
    (select customer_comms_enabled from public.workflow_settings limit 1) as comms_enabled,
    (select enabled from public.customer_delivery_settings where id = 1)  as delivery_enabled
),
universe as (
  select
    j.id,
    j.job_number,
    j.stage,
    j.created_at,
    j.eligibility_outcome,
    j.eligibility_decision_source,
    coalesce(j.eligibility_review_required, false) as review_required,
    j.source,
    j.channel,
    o.email,
    o.full_name,
    ie.area_m2,
    ie.area_source,
    ie.insulation_declared,
    p.enrichment -> 'base44' -> 'raw' as raw
  from public.jobs j
  join public.owners     o on o.id = j.owner_id
  join public.properties p on p.id = j.property_id
  join public.indicative_estimates ie
    on ie.job_id = j.id
   and ie.status = 'current'
  where j.deleted_at is null
    and j.eligibility_outcome in ('likely_eligible', 'needs_onsite_confirmation')
    and ie.insulation_declared in ('present', 'unknown')
    and coalesce(ie.area_source, '') <> 'typical_default'
    and coalesce(ie.area_m2, 0) > 0
),
media as (
  select
    u.id,
    -- Same attachment keys the app reads (properties.enrichment.base44.raw and .answers).
    coalesce(
      case when jsonb_typeof(u.raw -> 'media')            = 'array' then u.raw -> 'media'            end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'media') = 'array' then u.raw -> 'answers' -> 'media' end,
      case when jsonb_typeof(u.raw -> 'photos')           = 'array' then u.raw -> 'photos'            end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'photos') = 'array' then u.raw -> 'answers' -> 'photos' end,
      case when jsonb_typeof(u.raw -> 'videos')           = 'array' then u.raw -> 'videos'            end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'videos') = 'array' then u.raw -> 'answers' -> 'videos' end,
      case when jsonb_typeof(u.raw -> 'attachments')      = 'array' then u.raw -> 'attachments'       end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'attachments') = 'array' then u.raw -> 'answers' -> 'attachments' end,
      case when jsonb_typeof(u.raw -> 'uploaded_files')   = 'array' then u.raw -> 'uploaded_files'    end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'uploaded_files') = 'array' then u.raw -> 'answers' -> 'uploaded_files' end,
      case when jsonb_typeof(u.raw -> 'uploaded_photos')  = 'array' then u.raw -> 'uploaded_photos'   end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'uploaded_photos') = 'array' then u.raw -> 'answers' -> 'uploaded_photos' end,
      case when jsonb_typeof(u.raw -> 'uploaded_videos')  = 'array' then u.raw -> 'uploaded_videos'   end,
      case when jsonb_typeof(u.raw -> 'answers' -> 'uploaded_videos') = 'array' then u.raw -> 'answers' -> 'uploaded_videos' end
    ) as manifest,
    coalesce(u.raw -> 'original_media_manifest_uncertain' = 'true'::jsonb, false)   as manifest_flagged_uncertain,
    coalesce(u.raw -> 'original_media_verification' ->> 'complete' = 'true', false) as manifest_complete,
    (select count(*) from public.documents d
      where d.job_id = u.id
        and d.kind = 'intake_media'
        and (coalesce(d.mime_type, '') ~* '^(image|video)/'
             or d.storage_path ~* '\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v)$'))          as media_docs,
    (select count(*) from public.evidence_files f
      where f.job_id = u.id
        and f.storage_path like u.id::text || '/intake/%'
        and coalesce(f.mime_type, '') ~* '^(image|video)/')                                       as intake_evidence
  from universe u
),
facts as (
  select
    u.*,
    m.manifest,
    m.manifest_flagged_uncertain,
    m.manifest_complete,
    m.media_docs,
    m.media_docs + m.intake_evidence                                   as media_received,
    (m.manifest is not null)                                           as manifest_known,
    coalesce(jsonb_array_length(m.manifest), 0)                        as manifest_entries,
    (select count(*) from public.customer_email_optouts x
      where x.job_id = u.id and x.opted_out_at is not null)            as optouts,
    (select count(*) from public.lead_campaign_responses r
      where r.job_id = u.id and r.opted_out_at is not null)            as response_optouts,
    (select r.spot_saved_at from public.lead_campaign_responses r where r.job_id = u.id) as spot_saved_at,
    (select c.consent_status from public.owner_contact_consents c
      where c.job_id = u.id order by c.created_at desc limit 1)        as latest_consent,
    (select s.status from public.customer_email_sends s
      where s.idempotency_key = 'existing_leads_launch_v1:insulation_details:' || u.id::text
      order by s.created_at desc limit 1)                              as send_status,
    (select s.sent_at from public.customer_email_sends s
      where s.idempotency_key = 'existing_leads_launch_v1:insulation_details:' || u.id::text
      order by s.created_at desc limit 1)                              as sent_at,
    (select count(*) from public.customer_estimate_links l
      where l.job_id = u.id and l.purpose = 'step3_estimate' and l.status = 'active'
        and (l.expires_at is null or l.expires_at > now()))            as active_step3_links,
    (select count(*) from public.job_communications c
      where c.job_id = u.id
        and c.source_event = 'manual_office_communication:sent_manually'
        and c.source_reference = 'template:save_my_spot')              as manual_sends
  from universe u
  join media m on m.id = u.id
),
verdict as (
  select
    f.*,
    case
      when f.source <> 'base44' or f.channel <> 'hivic_sourced'
        then 'BLOCKED_NOT_WEBSITE_ENQUIRY'
      when f.stage in ('complete', 'cancelled', 'on_hold')
        then 'BLOCKED_CLOSED'
      when coalesce(btrim(f.email), '') = ''
        then 'BLOCKED_NO_EMAIL'
      when f.review_required
        then 'BLOCKED_REVIEW_REQUIRED'
      when f.eligibility_decision_source is null
        or f.eligibility_decision_source not in ('system', 'admin')
        then 'BLOCKED_NO_OFFICIAL_DECISION'
      when f.optouts > 0 or f.response_optouts > 0
        then 'BLOCKED_OPTED_OUT'
      when f.spot_saved_at is not null
        then 'BLOCKED_SPOT_ALREADY_SAVED'
      when f.latest_consent is distinct from 'granted'
        then 'BLOCKED_NO_CONTACT_CONSENT'
      when f.send_status in ('sent', 'delivered_unrecorded')
        then 'ALREADY_SENT_NO_ACTION'
      when f.send_status in ('sending', 'queued')
        then 'IN_FLIGHT_NO_ACTION'
      when f.manual_sends > 0
        then 'ALREADY_SENT_MANUALLY_NO_ACTION'
      when f.media_received > 0 or f.manifest_entries > 0
        then 'BLOCKED_MEDIA_ALREADY_RECEIVED'
      when not f.manifest_known
        or f.manifest_flagged_uncertain
        or (f.manifest_known and f.manifest_entries = 0 and not f.manifest_complete)
        then 'HOLD_MEDIA_SYNC_UNCERTAIN'
      when f.stage in ('new_enquiry', 'eligibility_review')
        then 'HOLD_NEEDS_ELIGIBILITY_STEP'
      else 'READY_FOR_EXISTING_SENDER'
    end as verdict
  from facts f
)
select
  v.job_number,
  v.id                                    as job_id,
  v.verdict,
  count(*) over (partition by v.verdict)  as same_verdict_count,
  case when v.send_status is null then 'not sent' else v.send_status end as insulation_email_status,
  v.sent_at,
  v.stage,
  v.eligibility_outcome,
  v.insulation_declared,
  v.area_m2,
  v.area_source,
  case v.verdict
    when 'READY_FOR_EXISTING_SENDER'
      then 'Will be sent by the existing worker -> sendAutomaticInsulationDetails (T6)'
    else ''
  end                                     as note,
  v.email,
  v.full_name,
  v.created_at,
  st.comms_enabled                        as customer_comms_enabled,
  st.delivery_enabled                     as customer_delivery_enabled,
  v.active_step3_links,
  v.media_docs,
  v.manifest_known,
  v.manifest_complete,
  v.latest_consent
from verdict v
cross join settings st
order by
  case v.verdict when 'READY_FOR_EXISTING_SENDER' then 0 else 1 end,
  v.created_at;

-- The headline number for "can be processed now" is same_verdict_count on any row whose verdict is
-- READY_FOR_EXISTING_SENDER. Every other verdict is the exact reason that row cannot go through
-- sendAutomaticInsulationDetails() today (and no email will be sent for it).
