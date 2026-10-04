-- Step 9 Part B: owner-picked install days; the quoted installer taking one = installation booked.
-- Additive only: one flag on appointment times (default false), one empty date on jobs, one index, one new function.
ALTER TABLE public.appointment_proposals ADD COLUMN IF NOT EXISTS install_day boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.appointment_proposals.install_day IS 'Owner-picked install day (kind installation). The quoted installer taking one books the install.';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS install_10day_flagged_at timestamptz;
COMMENT ON COLUMN public.jobs.install_10day_flagged_at IS 'When the 10-days-left (no install booked) needs-attention flag was raised. Empty = not flagged.';
CREATE INDEX IF NOT EXISTS appointment_proposals_install_day_idx ON public.appointment_proposals(job_id) WHERE install_day;

-- Locked step: the job's active quoted installer takes one owner day. First tap wins; a day after the
-- 30-day deadline is refused here as well as in the app (hard gate); an existing confirmed install booking blocks.
CREATE OR REPLACE FUNCTION public.accept_install_day(_proposal uuid, _assignment uuid, _user uuid, _deadline date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; a record;
BEGIN
  SELECT id, job_id, kind::text AS kind, status, starts_at, install_day INTO p FROM public.appointment_proposals WHERE id = _proposal FOR UPDATE;
  IF p.id IS NULL OR NOT p.install_day OR p.kind <> 'installation' THEN RETURN 'not_found'; END IF;
  SELECT id, job_id, role::text AS role, active INTO a FROM public.job_assignments WHERE id = _assignment FOR UPDATE;
  IF a.id IS NULL OR a.job_id <> p.job_id OR a.role <> 'installer' OR NOT a.active THEN RETURN 'not_installer'; END IF;
  IF p.status <> 'proposed' OR p.starts_at <= now() THEN RETURN 'day_unavailable'; END IF;
  IF _deadline IS NULL OR (p.starts_at AT TIME ZONE 'Australia/Melbourne')::date > _deadline THEN RETURN 'outside_window'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE job_id = p.job_id AND kind::text = 'installation' AND status::text = 'confirmed') THEN RETURN 'already_booked'; END IF;
  UPDATE public.appointment_proposals SET status = 'accepted', assignment_id = _assignment, responded_by = _user, responded_at = now(),
    response_note = 'Installer took this owner install day' WHERE id = p.id;
  UPDATE public.appointment_proposals SET status = 'superseded' WHERE job_id = p.job_id AND install_day AND status = 'proposed' AND id <> p.id;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal) VALUES
    (p.job_id, _user, 'install_day_taken', 'Installer took one of the owner''s install days', jsonb_build_object('proposal_id', p.id, 'assignment_id', _assignment, 'starts_at', p.starts_at), true);
  RETURN 'accepted';
END $$;
REVOKE ALL ON FUNCTION public.accept_install_day(uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_install_day(uuid, uuid, uuid, date) TO service_role;
