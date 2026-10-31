-- One-off backfill (staged, NOT yet run): installer-sourced jobs whose Mitti Ready Check was finished BEFORE the
-- "finished Mitti check = Attended: Yes" change went live. Today: HV-3117, HV-3197 (a test job), HV-3385, HV-3497, HV-3666.
-- 1. Live installer jobs (channel installer_sourced, not deleted) with a finished Mitti check (workflow_events
--    measurement_completed, details basis = mitti_complete) and installer_site_check not already 'yes':
--    set installer_site_check = 'yes' and installer_site_check_date = the Melbourne date of the earliest such event,
--    and log one internal installer_attended_from_mitti event (source 'backfill'). Jobs already logged are skipped.
-- 2. Live installer jobs (same scope), the ones with an installer_price_set event whose installer_quoted is not 'yes' (and whose latest
--    installer_quote_answer isn't have_quote): set installer_quoted = 'yes' and log one installer_quote_answer.
-- No new tables, functions or columns. One transaction. Safe to run twice (the second run changes nothing).
-- Run only after Jo says go — ask her again just before the live database is touched.
-- Proven on PGlite: tests/mitti-attended-backfill-db.test.ts.
begin;

with done as (
  select distinct on (e.job_id) e.job_id, e.created_at, e.details->>'audit_id' as audit_id
  from public.workflow_events e
  where e.event_type = 'measurement_completed' and e.details->>'basis' = 'mitti_complete'
  order by e.job_id, e.created_at, e.id
), flipped as (
  update public.jobs j
  set installer_site_check = 'yes',
      installer_site_check_date = (d.created_at at time zone 'Australia/Melbourne')::date
  from done d
  where d.job_id = j.id
    and j.channel = 'installer_sourced' and j.deleted_at is null
    and j.installer_site_check is distinct from 'yes'
    and not exists (select 1 from public.workflow_events x where x.job_id = j.id and x.event_type = 'installer_attended_from_mitti')
  returning j.id, d.created_at, d.audit_id
)
insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
select f.id, null, 'installer_attended_from_mitti', 'Attended: Yes — from the finished Mitti Ready Check',
       jsonb_build_object('audit_id', f.audit_id, 'completed_at', to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'source', 'backfill'), true
from flipped f;

with priced as (
  select j.id,
    (select x.details->>'answer' from public.workflow_events x
      where x.job_id = j.id and x.event_type = 'installer_quote_answer' order by x.created_at desc, x.id desc limit 1) as latest_answer
  from public.jobs j
  where j.channel = 'installer_sourced' and j.deleted_at is null
    and j.installer_quoted is distinct from 'yes'
    and exists (select 1 from public.workflow_events p where p.job_id = j.id and p.event_type = 'installer_price_set')
), fixed as (
  update public.jobs j set installer_quoted = 'yes'
  from priced p
  where p.id = j.id and p.latest_answer is distinct from 'have_quote'
  returning j.id, p.latest_answer
)
insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
select f.id, null, 'installer_quote_answer', 'Installer answered: quote prepared',
       jsonb_build_object('answer', 'have_quote', 'previous', f.latest_answer, 'source', 'backfill'), true
from fixed f;

commit;
