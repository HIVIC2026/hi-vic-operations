-- A6 (installer pages part 1, Jo approved 29 Oct 2026): no half-saved jobs from Add a job; "Try again" finishes the SAME job.
-- What: public.add_installer_job(_payload jsonb) saves the installer's new customer in ONE transaction — owner, property,
-- job, the installer's job_assignments row, the owner_contact_consents row, then the workflow events
-- `electrician_choice_set`, the optional HIV-lead clash flag (`duplicate_address_linked`, A2), `installer_job_added` and
-- `installer_contact_permission`. Any failure rolls the whole lot back, so a job can never exist without its consent,
-- its events or its office flag.
-- Why: the server used to write these one by one; a dropped signal or a failed write part-way left a job behind with
-- missing records, and tapping again could not finish it. The phone now keeps one request key per draft (kept across
-- retries and reloads); the job is stored with external_enquiry_id = 'onsite:' || request_key (already unique), so
-- calling again with the same key returns that job with created = false and writes nothing.
-- Payload (built by src/lib/add-installer-job.core.ts addInstallerJobPayload): request_key, business_id, user_id, source,
-- owner{full_name,email,phone}, property{address_line,suburb,postcode}, consent{key,by,text,sha256},
-- electrician_choice{choice,usual_name,usual_licence,source}, lead_origin, visit_requested, flag_event{summary,details}|null.
-- Wording and columns match today's step-by-step save in src/lib/onsite-ready-check.server.ts (legacySequentialSave),
-- including the same-business owner reuse while the old owners_email_uq index is still live
-- (owners-email-not-unique.sql). Until this is applied the server keeps using that step-by-step save.
-- Execute is granted to service_role only. Idempotent (create or replace). Undo: add-installer-job-atomic.undo.sql.
-- Proven on PGlite: tests/add-installer-job-practice-db.test.ts
create or replace function public.add_installer_job(_payload jsonb)
returns table(job_id uuid, job_number text, created boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  k text := nullif(btrim(_payload->>'request_key'), '');
  biz uuid := (_payload->>'business_id')::uuid;
  actor uuid := (_payload->>'user_id')::uuid;
  src text := _payload->>'source';
  o jsonb := coalesce(_payload->'owner', '{}'::jsonb);
  p jsonb := coalesce(_payload->'property', '{}'::jsonb);
  c jsonb := coalesce(_payload->'consent', '{}'::jsonb);
  ec jsonb := coalesce(_payload->'electrician_choice', '{}'::jsonb);
  fe jsonb := nullif(_payload->'flag_event', 'null'::jsonb);
  lo text := _payload->>'lead_origin';
  em text := nullif(lower(btrim(_payload->'owner'->>'email')), '');
  by_owner boolean;
  oid uuid; pid uuid; jid uuid; jnum text; jbiz uuid; t timestamptz := now(); et timestamptz;
begin
  if k is null or biz is null or actor is null then raise exception 'Add a job: request key, business and user are required'; end if;
  if src is null or src not in ('installer_onsite', 'qa_test') then raise exception 'Add a job: invalid source'; end if;
  if lo is null or lo not in ('owner_contacted', 'referral') then raise exception 'Jobs from door-knocking or cold calls can''t be added — the VEU Code of Conduct doesn''t allow them.'; end if;
  if ec->>'choice' is null or ec->>'choice' not in ('hivic', 'usual') then raise exception 'Add a job: invalid electrician choice'; end if;
  if c->>'by' is null or c->>'by' not in ('owner', 'installer') or nullif(c->>'text', '') is null or nullif(c->>'sha256', '') is null then raise exception 'Add a job: contact permission is missing'; end if;
  by_owner := c->>'by' = 'owner';

  -- One request key at a time: a double tap waits here, then finds the first tap's job below.
  perform pg_advisory_xact_lock(hashtext('add_installer_job:' || k));
  select j.id, j.job_number, j.originating_installer_business_id into jid, jnum, jbiz from public.jobs j where j.external_enquiry_id = 'onsite:' || k;
  if found then
    if jbiz is distinct from biz then raise exception 'Add a job: this request belongs to another business'; end if;
    return query select jid, jnum, false;
    return;
  end if;

  -- Every installer job gets its own owner row (decision 282). While owners_email_uq is still live, a known email may
  -- only reuse this business's own earlier installer customer — never anyone else's record (same as createInstallerOwner).
  begin
    insert into public.owners (full_name, email, phone) values (btrim(o->>'full_name'), em, btrim(o->>'phone')) returning id into oid;
  exception when unique_violation then
    select ow.id into oid from public.owners ow join public.jobs old on old.owner_id = ow.id
      where old.channel = 'installer_sourced' and old.originating_installer_business_id = biz and lower(ow.email) = em
      order by old.id limit 1;
    if oid is null then raise exception 'The customer could not be saved. Please contact the office for help; your entered details are kept.'; end if;
  end;
  insert into public.properties (owner_id, address_line, suburb, postcode, state)
    values (oid, btrim(p->>'address_line'), btrim(p->>'suburb'), btrim(p->>'postcode'), 'VIC') returning id into pid;
  insert into public.jobs (owner_id, property_id, stage, source, business_unit, installer_led, channel, originating_installer_business_id,
      originating_installer_user_id, external_enquiry_id, customer_relationship_owner, installer_site_check, installer_site_check_date,
      installer_quoted, next_action, electrician_choice)
    values (oid, pid, 'ready_check_ready_to_schedule', src, 'hivic', true, 'installer_sourced', biz,
      actor, 'onsite:' || k, 'installer', 'no', null,
      'no', 'Ready Check form being set up in Mitti', 'hivic_organise')
    returning id, job_number into jid, jnum;
  insert into public.job_assignments (job_id, user_id, role, business_id, assigned_by, first_response_at)
    values (jid, actor, 'installer', biz, actor, t);
  insert into public.owner_contact_consents (job_id, owner_id, source, consent_key, consent_status, contact_consent, consented_at, snapshot, sha256)
    values (jid, oid, 'onsite_ready_check', c->>'key', 'granted', true, t,
      jsonb_build_object('by', c->>'by', 'text', c->>'text', 'recorded_by', actor), c->>'sha256');

  -- Events in the same order as before. now() is the same for the whole transaction (and two clock readings can be
  -- equal), so each event gets its own microsecond step to keep that order when read back by created_at.
  et := clock_timestamp();
  insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal, created_at)
    values (jid, actor, 'electrician_choice_set',
      case when ec->>'choice' = 'usual'
        then 'Electrical safety check by the installer''s usual electrician' || coalesce(' (' || nullif(ec->>'usual_name', '') || ')', '')
        else 'Electrical safety check by Home Insulation Victoria''s electrician' end,
      ec || jsonb_build_object('business_id', biz, 'declared_not_verified', true), true, et + interval '0 microseconds');
  if fe is not null then
    insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal, created_at)
      values (jid, actor, 'duplicate_address_linked', fe->>'summary', coalesce(fe->'details', '{}'::jsonb), true, et + interval '1 microseconds');
  end if;
  insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal, created_at)
    values (jid, actor, 'installer_job_added',
      'Installer added this customer (Add a job: name, address, mobile, email, contact permission); the Mitti Ready Check form is created next',
      jsonb_build_object('business_id', biz, 'visit_requested', coalesce((_payload->>'visit_requested')::boolean, false), 'lead_origin', lo), false, et + interval '2 microseconds');
  insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal, created_at)
    values (jid, actor, 'installer_contact_permission',
      case when by_owner then 'Owner ticked contact and privacy consent on the installer''s phone' else 'Installer confirmed the owner gave consent' end,
      jsonb_build_object('wording', c->>'text', 'by', c->>'by'), true, et + interval '3 microseconds');
  return query select jid, jnum, true;
end $$;

revoke all on function public.add_installer_job(jsonb) from public, anon, authenticated;
grant execute on function public.add_installer_job(jsonb) to service_role;
