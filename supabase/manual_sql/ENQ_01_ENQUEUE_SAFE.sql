-- ===================================================================================================
-- ENQUIRY BACKLOG — STEP 2 of 4 — THE ONLY WRITE. Adds no code and sends nothing directly.
--
-- Puts categories A (eligible), B (ineligible with a verified reason) and C (insulation to confirm) into the
-- EXISTING post-intake queue. The EXISTING pg_cron worker then runs the EXISTING processor, which ends in
-- maybeAutoRouteLeadEmail(jobId) -> the existing senders (sendSaveMySpot / sendAutomaticInsulationDetails /
-- sendDecisionIneligibleEmail). Every send re-checks consent, opt-out, duplicate, media, coverage, switches
-- and template approval inside those senders; this file only chooses who is worth attempting.
--
-- Deliberately NOT enqueued: D (media already uploaded) and E (ambiguous) — Jo requires a human decision.
--
-- Run ENQ_00 first and compare `enqueued` with its AUTO_SEND + AUTO_SEND_RETRY totals. Re-running is safe:
-- UNIQUE (job_id, work_type) makes this idempotent, and an item already 'processing' is left alone.
-- ===================================================================================================

with settings as (
  select
    (select customer_comms_enabled from public.workflow_settings limit 1) as comms_enabled,
    (select enabled from public.customer_delivery_settings where id = 1)  as delivery_enabled
),
universe as (
  select
    j.id, j.stage, j.source, j.channel, j.eligibility_outcome, j.eligibility_decision_source, j.eligibility_reason,
    coalesce(j.eligibility_review_required, false) as review_required,
    o.email,
    ie.insulation_declared,
    p.enrichment -> 'base44' -> 'raw' as raw
  from public.jobs j
  join public.owners o on o.id = j.owner_id
  join public.properties p on p.id = j.property_id
  left join public.indicative_estimates ie on ie.job_id = j.id and ie.status = 'current'
  where j.deleted_at is null
    and j.source = 'base44'
    and j.channel = 'hivic_sourced'
    -- LEGACY EXCLUSIONS (must match HOT_EXCLUDED_JOBS / HOT_HIDDEN_DUPLICATES in src/lib/hot-leads.core.ts):
    and j.job_number not in ('HV-1059', 'HV-1061', 'HV-1063', 'HV-1257', 'HV-1291', 'HV-1161', 'HV-1437') -- LEGACY_EXCLUDED_LIST
    and j.job_number not in ('HV-1225', 'HV-1242', 'HV-1286', 'HV-1475', 'HV-1180') -- HIDDEN_DUPLICATE_LIST
    and j.stage in ('new_enquiry', 'eligibility_review', 'preliminary_estimate_ready', 'on_hold')
    and coalesce(j.eligibility_review_required, false) = false
    and j.eligibility_decision_source in ('system', 'admin')
    and j.eligibility_outcome in ('likely_eligible', 'needs_onsite_confirmation', 'does_not_appear_eligible')
    and (j.eligibility_outcome <> 'does_not_appear_eligible' or coalesce(btrim(j.eligibility_reason), '') <> '')
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
eligible as (
  select u.id
  from universe u
  join media m on m.id = u.id
  cross join settings s
  where s.comms_enabled is true      -- both COM-04 switches must already be on; nothing here turns them on
    and s.delivery_enabled is true
    and coalesce(trim(u.email), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    -- Only the three automatic categories. A: no insulation. C: present/unknown with media proven absent.
    -- MANDATORY STAGE SAFETY (never bypassed by the trusted backlog context; must match ENQ_00 exactly):
    --   first-response routes T1/T2/T5/T6 -> stage in (new_enquiry, eligibility_review, preliminary_estimate_ready)
    --   ineligible route T7               -> stage in (new_enquiry, eligibility_review, on_hold)
    and (
      (u.eligibility_outcome = 'likely_eligible' and u.insulation_declared = 'none'
          and u.stage in ('new_enquiry', 'eligibility_review', 'preliminary_estimate_ready'))
      or (u.eligibility_outcome = 'does_not_appear_eligible'
          and u.stage in ('new_enquiry', 'eligibility_review', 'on_hold'))
      or (u.eligibility_outcome in ('likely_eligible', 'needs_onsite_confirmation')
          and u.insulation_declared in ('present', 'unknown')
          and u.stage in ('new_enquiry', 'eligibility_review', 'preliminary_estimate_ready')
          and m.media_docs = 0 and m.intake_evidence = 0
          and m.manifest is not null and jsonb_array_length(m.manifest) = 0
          and m.manifest_complete and not m.manifest_flagged_uncertain)
    )
    and (select count(*) from public.customer_email_optouts x
          where x.job_id = u.id and x.opted_out_at is not null) = 0
    and (select count(*) from public.lead_campaign_responses r
          where r.job_id = u.id and r.opted_out_at is not null) = 0
    and (select r.spot_saved_at from public.lead_campaign_responses r where r.job_id = u.id) is null
    and (select c.consent_status from public.owner_contact_consents c
          where c.job_id = u.id order by c.created_at desc limit 1) = 'granted'
    -- Never re-attempt a home that already got a correct purpose-specific response, or is mid-send.
    and (select count(*) from public.customer_email_sends se
          where se.job_id = u.id
            and (se.status in ('sent', 'delivered_unrecorded', 'sending', 'queued')
                 and (se.purpose in ('existing_leads_launch_v1', 'insulation_video_request', 'preliminary_ineligible')
                      or se.idempotency_key like '%:insulation_details:%'))) = 0
    and (select count(*) from public.job_communications jc
          where jc.job_id = u.id and jc.source_event = 'manual_office_communication:sent_manually'
            and jc.source_reference like 'template:%') = 0
),
queued as (
  insert into public.post_intake_work as w
    (job_id, work_type, status, facts_version, reason, attempts, available_at,
     locked_at, lease_expires_at, last_error, completed_at)
  select e.id, 'initial_gate1', 'queued', 'enquiry-backlog-manual', 'ENQUIRY_BACKLOG_MANUAL',
         0, now(), null, null, null, null
  from eligible e
  on conflict (job_id, work_type) do update
    set status           = 'queued',
        attempts         = 0,
        available_at     = now(),
        locked_at        = null,
        lease_expires_at = null,
        last_error       = null,
        completed_at     = null,
        facts_version    = 'enquiry-backlog-manual',
        reason           = 'ENQUIRY_BACKLOG_MANUAL'
  where w.status <> 'processing'
  returning 1
)
select count(*) as enqueued from queued;

-- The worker drains 5 items per 2-minute tick; expect roughly (enqueued / 5) * 2 minutes.
-- Nothing is sent by this statement. Casing/wording is chosen by the app, not by this file.
