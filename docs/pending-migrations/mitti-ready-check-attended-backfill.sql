-- One-off backfill (staged, NOT yet run): installer-sourced jobs whose Mitti Ready Check was finished BEFORE the
-- "finished Mitti check = Attended: Yes" change went live. ONLY these 5 jobs: HV-3117, HV-3197 (a test job), HV-3385,
-- HV-3497, HV-3666 — every other job is left alone.
-- 1. Attended: one of the 5, live installer job (channel installer_sourced, not deleted) with a finished Mitti check
--    (workflow_events measurement_completed, details basis = mitti_complete), installer_site_check not already 'yes',
--    not already logged, and no hand attendance answer (installer_attendance_answer) after the first Mitti finish:
--    set installer_site_check = 'yes' and installer_site_check_date = the Melbourne date of that first finish, and log
--    one internal installer_attended_from_mitti event (source 'backfill').
-- 2. Quote prepared: one of the 5, same scope, with the finished-Mitti marker and an installer_price_set event, whose
--    installer_quoted is not 'yes', whose latest installer_quote_answer isn't have_quote and is not newer than its latest
--    installer_price_set (the installer's own later answer wins): set installer_quoted = 'yes' and log one
--    installer_quote_answer.
-- No new tables, functions or columns. One transaction. Safe to run twice (the second run changes nothing).
-- Run only after Jo says go — ask her again just before the live database is touched.
-- Proven on PGlite: tests/mitti-attended-backfill-db.test.ts (which also runs the preview below).
--
-- READ-ONLY PREVIEW (show Jo before the live run; changes nothing):
-- PREVIEW BEGIN
-- with five as (
--   select j.id, j.job_number, j.stage, j.channel, j.deleted_at, j.installer_site_check, j.installer_quoted,
--     (select min(e.created_at) from public.workflow_events e where e.job_id = j.id and e.event_type = 'measurement_completed' and e.details->>'basis' = 'mitti_complete') as mitti_done_at,
--     (select max(e.created_at) from public.workflow_events e where e.job_id = j.id and e.event_type = 'installer_attendance_answer') as hand_attended_at,
--     exists (select 1 from public.workflow_events e where e.job_id = j.id and e.event_type = 'installer_attended_from_mitti') as attended_logged,
--     (select max(e.created_at) from public.workflow_events e where e.job_id = j.id and e.event_type = 'installer_price_set') as priced_at,
--     (select e.created_at from public.workflow_events e where e.job_id = j.id and e.event_type = 'installer_quote_answer' order by e.created_at desc, e.id desc limit 1) as answer_at,
--     (select e.details->>'answer' from public.workflow_events e where e.job_id = j.id and e.event_type = 'installer_quote_answer' order by e.created_at desc, e.id desc limit 1) as latest_answer
--   from public.jobs j
--   where j.job_number in ('HV-3117','HV-3197','HV-3385','HV-3497','HV-3666')
-- )
-- select job_number, stage, installer_site_check, installer_quoted,
--   (channel = 'installer_sourced' and deleted_at is null and mitti_done_at is not null and installer_site_check is distinct from 'yes'
--     and not attended_logged and (hand_attended_at is null or hand_attended_at <= mitti_done_at)) as step1_sets_attended_yes,
--   (channel = 'installer_sourced' and deleted_at is null and mitti_done_at is not null and priced_at is not null and installer_quoted is distinct from 'yes'
--     and latest_answer is distinct from 'have_quote' and (answer_at is null or answer_at <= priced_at)) as step2_sets_quote_prepared
-- from five order by job_number;
-- PREVIEW END
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
    and j.job_number in ('HV-3117','HV-3197','HV-3385','HV-3497','HV-3666')
    and j.channel = 'installer_sourced' and j.deleted_at is null
    and j.installer_site_check is distinct from 'yes'
    and not exists (select 1 from public.workflow_events x where x.job_id = j.id and x.event_type = 'installer_attended_from_mitti')
    and not exists (select 1 from public.workflow_events h where h.job_id = j.id and h.event_type = 'installer_attendance_answer' and h.created_at > d.created_at)
  returning j.id, d.created_at, d.audit_id
)
insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
select f.id, null, 'installer_attended_from_mitti', 'Attended: Yes — from the finished Mitti Ready Check',
       jsonb_build_object('audit_id', f.audit_id, 'completed_at', to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'source', 'backfill'), true
from flipped f;

with priced as (
  select j.id,
    (select max(p.created_at) from public.workflow_events p where p.job_id = j.id and p.event_type = 'installer_price_set') as priced_at,
    (select x.created_at from public.workflow_events x
      where x.job_id = j.id and x.event_type = 'installer_quote_answer' order by x.created_at desc, x.id desc limit 1) as answer_at,
    (select x.details->>'answer' from public.workflow_events x
      where x.job_id = j.id and x.event_type = 'installer_quote_answer' order by x.created_at desc, x.id desc limit 1) as latest_answer
  from public.jobs j
  where j.job_number in ('HV-3117','HV-3197','HV-3385','HV-3497','HV-3666')
    and j.channel = 'installer_sourced' and j.deleted_at is null
    and j.installer_quoted is distinct from 'yes'
    and exists (select 1 from public.workflow_events m where m.job_id = j.id and m.event_type = 'measurement_completed' and m.details->>'basis' = 'mitti_complete')
    and exists (select 1 from public.workflow_events p where p.job_id = j.id and p.event_type = 'installer_price_set')
), fixed as (
  update public.jobs j set installer_quoted = 'yes'
  from priced p
  where p.id = j.id and p.latest_answer is distinct from 'have_quote'
    and (p.answer_at is null or p.answer_at <= p.priced_at)
  returning j.id, p.latest_answer
)
insert into public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
select f.id, null, 'installer_quote_answer', 'Installer answered: quote prepared',
       jsonb_build_object('answer', 'have_quote', 'previous', f.latest_answer, 'source', 'backfill'), true
from fixed f;

commit;
