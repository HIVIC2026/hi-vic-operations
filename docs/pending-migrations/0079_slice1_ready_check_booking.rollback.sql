-- Rollback for 0079 (test copy). Nothing existing is altered except added nullable/defaulted columns,
-- so switching the flag off is the first-line rollback; this file removes the additions entirely.
DROP TRIGGER IF EXISTS jobs_slice1_stage_guard ON public.jobs;
DROP FUNCTION IF EXISTS public.slice1_stage_guard();
DROP FUNCTION IF EXISTS public.rc_confirm_time(uuid, uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.rc_request_ready_check(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.rc_approve_estimate(uuid, uuid, timestamptz, text);
ALTER TABLE public.appointment_proposals DROP COLUMN IF EXISTS office_evidence, DROP COLUMN IF EXISTS entered_by_party,
  DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS visit_id;
DROP TABLE IF EXISTS public.visit_task_recipients, public.visit_tasks, public.contact_disclosures,
  public.visits, public.ready_check_requests, public.estimate_approvals;
DROP FUNCTION IF EXISTS public.slice1_enabled();
ALTER TABLE public.workflow_settings DROP COLUMN IF EXISTS slice1_contact_sharing_enabled, DROP COLUMN IF EXISTS slice1_ready_check_enabled;
