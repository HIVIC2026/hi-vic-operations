-- ===================================================================================================
-- T6 BACKLOG — STEP 2 of 4 — THE ONLY WRITE. Does not add code and does not send anything directly.
--
-- WHAT IT DOES: puts the ready candidates into the EXISTING post-intake queue
-- (public.post_intake_work, work_type = 'initial_gate1'). The EXISTING pg_cron job
-- "hivic-post-intake-worker" (every 2 minutes, 5 items per tick) then runs the EXISTING processor
-- postintake.server.ts -> processItem(), which ends with:
--     maybeAutoRouteLeadEmail(job_id)
--       -> automaticLeadEmail() = "request_insulation"
--       -> groupBInvitationBlocker(...)
--       -> syncStep3(job_id)                    (refreshes the saved estimate + this customer's link)
--       -> sendAutomaticInsulationDetails(job_id)
--          -> sendOne(...) -> renderJoOutcomeEmail() = Jo's T6 copy
-- No new sender, no new endpoint, no new dashboard button.
--
-- ORDER OF OPERATIONS: run T6_01 first, confirm the READY_FOR_EXISTING_SENDER rows, then run this.
-- Re-running is safe: it re-queues at most the same rows (UNIQUE (job_id, work_type)).
-- An item already 'processing' is left alone (a second worker must never double-run it).
-- ===================================================================================================

with settings as (
  select
    (select customer_comms_enabled from public.workflow_settings limit 1) as comms_enabled,
    (select enabled from public.customer_delivery_settings where id = 1)  as delivery_enabled
),
candidates as (
  select
    j.id,
    j.stage,
    j.source,
    j.channel,
    coalesce(j.eligibility_review_required, false) as review_required,
    j.eligibility_decision_source,
    o.email,
    ie.area_m2,
    ie.area_source,
    ie.insulation_declared,
    p.enrichment -> 'base44' -> 'raw' as raw
  from public.jobs j
  join public.owners     o on o.id = j.owner_id
  join public.properties p on p.id = j.property_id
  join public.indicative_estimates ie on ie.job_id = j.id and ie.status = 'current'
  where j.deleted_at is null
    and j.source = 'base44'
    and j.channel = 'hivic_sourced'
    and j.stage not in ('complete', 'cancelled', 'on_hold', 'new_enquiry', 'eligibility_review')
    and j.eligibility_outcome in ('likely_eligible', 'needs_onsite_confirmation')
    and coalesce(j.eligibility_review_required, false) = false
    and j.eligibility_decision_source in ('system', 'admin')
    and ie.insulation_declared in ('present', 'unknown')
    and coalesce(ie.area_source, '') <> 'typical_default'   -- typical_default would render T5, not T6
    and coalesce(ie.area_m2, 0) > 0
),
media as (
  select
    c.id,
    coalesce(
      case when jsonb_typeof(c.raw -> 'media')            = 'array' then c.raw -> 'media'            end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'media') = 'array' then c.raw -> 'answers' -> 'media' end,
      case when jsonb_typeof(c.raw -> 'photos')           = 'array' then c.raw -> 'photos'            end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'photos') = 'array' then c.raw -> 'answers' -> 'photos' end,
      case when jsonb_typeof(c.raw -> 'videos')           = 'array' then c.raw -> 'videos'            end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'videos') = 'array' then c.raw -> 'answers' -> 'videos' end,
      case when jsonb_typeof(c.raw -> 'attachments')      = 'array' then c.raw -> 'attachments'       end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'attachments') = 'array' then c.raw -> 'answers' -> 'attachments' end,
      case when jsonb_typeof(c.raw -> 'uploaded_files')   = 'array' then c.raw -> 'uploaded_files'    end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'uploaded_files') = 'array' then c.raw -> 'answers' -> 'uploaded_files' end,
      case when jsonb_typeof(c.raw -> 'uploaded_photos')  = 'array' then c.raw -> 'uploaded_photos'   end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'uploaded_photos') = 'array' then c.raw -> 'answers' -> 'uploaded_photos' end,
      case when jsonb_typeof(c.raw -> 'uploaded_videos')  = 'array' then c.raw -> 'uploaded_videos'   end,
      case when jsonb_typeof(c.raw -> 'answers' -> 'uploaded_videos') = 'array' then c.raw -> 'answers' -> 'uploaded_videos' end
    ) as manifest,
    coalesce(c.raw -> 'original_media_manifest_uncertain' = 'true'::jsonb, false)   as manifest_flagged_uncertain,
    coalesce(c.raw -> 'original_media_verification' ->> 'complete' = 'true', false) as manifest_complete,
    (select count(*) from public.documents d
      where d.job_id = c.id and d.kind = 'intake_media'
        and (coalesce(d.mime_type, '') ~* '^(image|video)/'
             or d.storage_path ~* '\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v)$'))  as media_docs,
    (select count(*) from public.evidence_files f
      where f.job_id = c.id and f.storage_path like c.id::text || '/intake/%'
        and coalesce(f.mime_type, '') ~* '^(image|video)/')                              as intake_evidence
  from candidates c
),
ready as (
  select c.id as job_id
  from candidates c
  join media m on m.id = c.id
  cross join settings s
  where s.comms_enabled is true            -- Group B needs BOTH switches (groupBGlobalsOn())
    and s.delivery_enabled is true
    and coalesce(trim(c.email), '') <> ''
    and (select count(*) from public.customer_email_optouts x
          where x.job_id = c.id and x.opted_out_at is not null) = 0
    and (select count(*) from public.lead_campaign_responses r
          where r.job_id = c.id and (r.opted_out_at is not null or r.spot_saved_at is not null)) = 0
    and (select c2.consent_status from public.owner_contact_consents c2
          where c2.job_id = c.id order by c2.created_at desc limit 1) = 'granted'
    and (select count(*) from public.customer_email_sends se
          where se.job_id = c.id
            and se.idempotency_key = 'existing_leads_launch_v1:insulation_details:' || c.id::text
            and se.status in ('sent', 'delivered_unrecorded', 'sending', 'queued')) = 0
    and (select count(*) from public.job_communications jc
          where jc.job_id = c.id
            and jc.source_event = 'manual_office_communication:sent_manually'
            and jc.source_reference = 'template:save_my_spot') = 0
    -- Group B invitation guard: nothing already received, and the original media sync is PROVEN clear.
    and m.media_docs = 0
    and m.intake_evidence = 0
    and m.manifest is not null
    and jsonb_array_length(m.manifest) = 0
    and m.manifest_complete
    and not m.manifest_flagged_uncertain
),
queued as (
  insert into public.post_intake_work as w
    (job_id, work_type, status, facts_version, reason, attempts, available_at,
     locked_at, lease_expires_at, last_error, completed_at)
  select
    r.job_id, 'initial_gate1', 'queued', 't6-backlog-manual',
    'T6_BACKLOG_MANUAL', 0, now(), null, null, null, null
  from ready r
  on conflict (job_id, work_type) do update
    set status          = 'queued',
        attempts        = 0,
        available_at    = now(),
        locked_at       = null,
        lease_expires_at = null,
        last_error      = null,
        completed_at    = null,
        facts_version   = 't6-backlog-manual',
        reason          = 'T6_BACKLOG_MANUAL'
  where w.status <> 'processing'
  returning 1
)
select count(*) as enqueued
from queued;

-- Expect: enqueued = the READY_FOR_EXISTING_SENDER count from T6_01 (minus anything already processing).
-- The existing worker picks up 5 per 2-minute tick, so 241 items take about 1.6 hours.
