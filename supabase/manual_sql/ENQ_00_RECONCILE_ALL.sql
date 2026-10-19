-- ===================================================================================================
-- ENQUIRY BACKLOG — STEP 1 of 4 — READ ONLY. Sends nothing, changes nothing.
--
-- One row per outstanding website enquiry with Jo's category, the template the sender would use and the
-- disposition. This is the reconciliation of the WHOLE backlog, not a single category.
--
-- The app is authoritative: `automaticLeadEmail()` / `groupBInvitationBlocker()` / `renderJoOutcomeEmail()`
-- decide at send time and re-check every gate. This query only predicts, so the Office knows the size of
-- each category before anything is queued. Category names:
--   A_ELIGIBLE_NO_INSULATION   eligible, no existing insulation      -> automatic (T1/T2)
--   B_INELIGIBLE               ineligible + verified reason          -> automatic (T7)
--   C_INSULATION_UNKNOWN       insulation present/unknown, no media  -> automatic (T5/T6)
--   D_EXISTING_INSULATION_MEDIA media already uploaded               -> OFFICE REVIEW (never auto-decided)
--   E_AMBIGUOUS                missing/contradictory facts           -> OFFICE REVIEW
--   F_ALREADY_RESPONDED        correct purpose-specific email sent   -> no action
--   G_OPTOUT_OR_NO_CONSENT     suppressed                            -> blocked
--   H_NO_RECIPIENT             missing/invalid email                 -> blocked
--   J_OTHER_BLOCKER            in flight / anything else             -> blocked
-- A previous failure does not create a separate category: it keeps the category and reads AUTO_SEND_RETRY,
-- because the sender only ever re-sends a confirmed failure (atomic re-reserve).
-- ===================================================================================================

with universe as (
  select
    j.id, j.job_number, j.stage, j.created_at, j.source, j.channel,
    j.eligibility_outcome, j.eligibility_decision_source, j.eligibility_reason,
    coalesce(j.eligibility_review_required, false) as review_required,
    o.email, o.full_name,
    ie.area_m2, ie.area_source, ie.insulation_declared,
    p.enrichment -> 'base44' -> 'raw' as raw
  from public.jobs j
  join public.owners o on o.id = j.owner_id
  join public.properties p on p.id = j.property_id
  left join public.indicative_estimates ie on ie.job_id = j.id and ie.status = 'current'
  where j.deleted_at is null
    and j.source = 'base44'
    and j.channel = 'hivic_sourced'
),
media as (
  select
    u.id,
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
      where d.job_id = u.id and d.kind = 'intake_media'
        and (coalesce(d.mime_type, '') ~* '^(image|video)/'
             or d.storage_path ~* '\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v)$')) as media_docs,
    (select count(*) from public.evidence_files f
      where f.job_id = u.id and f.storage_path like u.id::text || '/intake/%'
        and coalesce(f.mime_type, '') ~* '^(image|video)/')                            as intake_evidence
  from universe u
),
facts as (
  select
    u.*,
    m.manifest, m.manifest_flagged_uncertain, m.manifest_complete, m.media_docs,
    m.media_docs + m.intake_evidence            as media_received,
    (m.manifest is not null)                    as manifest_known,
    coalesce(jsonb_array_length(m.manifest), 0) as manifest_entries,
    (select count(*) from public.customer_email_optouts x
      where x.job_id = u.id and x.opted_out_at is not null)              as optouts,
    (select count(*) from public.lead_campaign_responses r
      where r.job_id = u.id and r.opted_out_at is not null)              as response_optouts,
    (select r.spot_saved_at from public.lead_campaign_responses r where r.job_id = u.id) as spot_saved_at,
    (select c.consent_status from public.owner_contact_consents c
      where c.job_id = u.id order by c.created_at desc limit 1)          as consent,
    (select count(*) from public.owner_contact_consents c
      where c.job_id = u.id)                                             as consent_rows,
    (select count(*) from public.customer_email_sends s
      where s.job_id = u.id and s.status in ('sent', 'delivered_unrecorded')
        and (s.purpose = 'existing_leads_launch_v1' or s.purpose = 'insulation_video_request'
             or s.purpose = 'preliminary_ineligible'
             or s.idempotency_key like '%:insulation_details:%'))        as answered_sends,
    (select count(*) from public.customer_email_sends s
      where s.job_id = u.id and s.status = 'failed'
        and (s.idempotency_key like '%:insulation_details:%' or s.purpose = 'insulation_video_request'
             or s.purpose = 'preliminary_ineligible' or s.purpose = 'existing_leads_launch_v1'))  as failed_sends,
    (select count(*) from public.customer_email_sends s
      where s.job_id = u.id and s.status in ('sending', 'queued'))        as inflight_sends,
    (select count(*) from public.job_communications c
      where c.job_id = u.id and c.source_event = 'manual_office_communication:sent_manually'
        and c.source_reference like 'template:%')                        as manual_sends
  from universe u
  join media m on m.id = u.id
),
classified as (
  select
    f.*,
    case
      when f.answered_sends > 0 or f.manual_sends > 0 then 'F_ALREADY_RESPONDED'
      when f.inflight_sends > 0 then 'J_OTHER_BLOCKER'
      when f.optouts > 0 or f.response_optouts > 0 then 'G_OPTOUT_OR_NO_CONSENT'
      when coalesce(trim(f.email), '') = '' or f.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'H_NO_RECIPIENT'
      when f.consent is distinct from 'granted' then 'G_OPTOUT_OR_NO_CONSENT'
      when f.review_required then 'E_AMBIGUOUS'
      when f.eligibility_decision_source is null
        or f.eligibility_decision_source not in ('system', 'admin') then 'E_AMBIGUOUS'
      when f.eligibility_outcome = 'does_not_appear_eligible'
        then case when coalesce(btrim(f.eligibility_reason), '') = '' then 'E_AMBIGUOUS' else 'B_INELIGIBLE' end
      when f.eligibility_outcome = 'likely_eligible' and f.insulation_declared = 'none'
        then 'A_ELIGIBLE_NO_INSULATION'
      when f.eligibility_outcome in ('likely_eligible', 'needs_onsite_confirmation')
        and f.insulation_declared in ('present', 'unknown')
        then case
               when f.media_received > 0 or f.manifest_entries > 0 then 'D_EXISTING_INSULATION_MEDIA'
               when not f.manifest_known or f.manifest_flagged_uncertain
                 or (f.manifest_entries = 0 and not f.manifest_complete) then 'E_AMBIGUOUS'
               else 'C_INSULATION_UNKNOWN'
             end
      when f.eligibility_outcome is null then 'E_AMBIGUOUS'
      else 'J_OTHER_BLOCKER'
    end as category
  from facts f
),
scored as (
  select
    c.*,
    case
      when c.category = 'A_ELIGIBLE_NO_INSULATION' then
        case when c.area_m2 is not null and coalesce(c.area_source, '') <> 'typical_default' and c.area_m2 > 0
             then 'T2 eligible / no insulation / size known'
             else 'T1 eligible / no insulation / 150 m2 assumption (labelled)' end
      when c.category = 'B_INELIGIBLE' then 'T7 ineligible (verified reason)'
      when c.category = 'C_INSULATION_UNKNOWN' then
        case when c.area_m2 is not null and coalesce(c.area_source, '') <> 'typical_default' and c.area_m2 > 0
             then 'T6 potentially eligible / insulation to confirm / size known'
             else 'T5 potentially eligible / insulation to confirm / size unknown' end
      when c.category = 'D_EXISTING_INSULATION_MEDIA' then 'None — Office decides after reviewing the media'
      when c.category = 'E_AMBIGUOUS' then 'None — needs a human decision'
      else 'None'
    end as proposed_template,
    case
      when c.category in ('A_ELIGIBLE_NO_INSULATION', 'B_INELIGIBLE', 'C_INSULATION_UNKNOWN')
        then case when c.failed_sends > 0 then 'AUTO_SEND_RETRY' else 'AUTO_SEND' end
      when c.category in ('D_EXISTING_INSULATION_MEDIA', 'E_AMBIGUOUS') then 'OFFICE_REVIEW'
      when c.category = 'F_ALREADY_RESPONDED' then 'NO_ACTION'
      else 'BLOCKED'
    end as disposition
  from classified c
)
select
  s.job_number, s.id as job_id, s.category, s.disposition, s.proposed_template,
  count(*) over (partition by s.category) as category_total,
  s.stage, s.created_at,
  s.eligibility_outcome, s.eligibility_reason, s.insulation_declared, s.area_m2, s.area_source,
  s.media_received, s.media_docs, s.manifest_known, s.manifest_complete,
  s.consent, s.email, s.full_name,
  s.answered_sends, s.failed_sends, s.inflight_sends, s.manual_sends
from scored s
order by
  case s.disposition when 'AUTO_SEND' then 0 when 'RETRY_SAFE' then 1 when 'OFFICE_REVIEW' then 2 else 3 end,
  s.created_at;
