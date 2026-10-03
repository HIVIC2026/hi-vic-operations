-- Slice 1: office-approved estimate -> Ready Check request -> visit -> contact sharing -> confirmed booking.
-- PENDING. Test-copy (PGlite) only until Jo approves a production run. Additive only.
-- Feature flag workflow_settings.slice1_ready_check_enabled defaults FALSE: every rc_* function refuses
-- and the new stage guard is inactive, so the live app behaves exactly as today.

-- 1. Flags (fail closed)
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS slice1_ready_check_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slice1_contact_sharing_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.slice1_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$ SELECT coalesce((SELECT slice1_ready_check_enabled FROM public.workflow_settings ORDER BY id LIMIT 1), false) $$;

-- 2. Tables
CREATE TABLE public.estimate_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.indicative_estimates(id),
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  note text,
  superseded_at timestamptz,
  superseded_reason text
);
CREATE UNIQUE INDEX estimate_approvals_one_current ON public.estimate_approvals(job_id) WHERE superseded_at IS NULL;

CREATE TABLE public.ready_check_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  approval_id uuid NOT NULL REFERENCES public.estimate_approvals(id),
  requested_via text NOT NULL CHECK (requested_via IN ('owner_link','office_recorded')),
  contact_consent_version text NOT NULL,
  office_evidence text,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled','fulfilled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_via <> 'office_recorded' OR length(trim(coalesce(office_evidence,''))) > 0)
);
CREATE UNIQUE INDEX ready_check_requests_one_open ON public.ready_check_requests(job_id) WHERE status = 'open';

CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.ready_check_requests(id),
  assignment_id uuid NOT NULL REFERENCES public.job_assignments(id),
  assignment_version integer NOT NULL DEFAULT 1,
  kind text NOT NULL DEFAULT 'ready_check',
  status text NOT NULL DEFAULT 'awaiting_time'
    CHECK (status IN ('awaiting_time','time_entered','confirmed','cancelled','superseded')),
  contacts_released_at timestamptz,
  confirmed_proposal_id uuid,
  confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX visits_one_live ON public.visits(job_id, kind) WHERE status IN ('awaiting_time','time_entered','confirmed');

CREATE TABLE public.contact_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  assignment_id uuid NOT NULL REFERENCES public.job_assignments(id),
  assignment_version integer NOT NULL,
  disclosed_by uuid,
  recipient_user_id uuid NOT NULL,
  recipient_role text NOT NULL CHECK (recipient_role IN ('owner','trade')),
  fields text[] NOT NULL,
  purpose text NOT NULL DEFAULT 'arrange_ready_check',
  consent_basis text NOT NULL,
  consent_version text NOT NULL,
  notice_version text NOT NULL,
  notice_accepted_at timestamptz NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
);

CREATE TABLE public.visit_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder_24h','office_alert_48h')),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visit_id, kind)
);

CREATE TABLE public.visit_task_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.visit_tasks(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  recipient_role text NOT NULL CHECK (recipient_role IN ('owner','trade','office')),
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','sent','suppressed','failed')),
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, recipient_role, recipient_user_id)
);

ALTER TABLE public.appointment_proposals
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.visits(id),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS entered_by_party text CHECK (entered_by_party IN ('owner','trade','office')),
  ADD COLUMN IF NOT EXISTS office_evidence text;

-- 3. Grants: read-only for signed-in users (RLS scoped); all writes go through rc_* functions.
GRANT SELECT ON public.estimate_approvals, public.ready_check_requests, public.visits,
  public.contact_disclosures, public.visit_tasks, public.visit_task_recipients TO authenticated;
GRANT ALL ON public.estimate_approvals, public.ready_check_requests, public.visits,
  public.contact_disclosures, public.visit_tasks, public.visit_task_recipients TO service_role;

-- 4. RLS
ALTER TABLE public.estimate_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ready_check_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_task_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "office reads approvals" ON public.estimate_approvals FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "job parties read requests" ON public.ready_check_requests FOR SELECT TO authenticated USING (public.is_admin() OR public.can_access_job(job_id));
CREATE POLICY "job parties read visits" ON public.visits FOR SELECT TO authenticated USING (public.is_admin() OR public.can_access_job(job_id));
CREATE POLICY "office or recipient reads disclosures" ON public.contact_disclosures FOR SELECT TO authenticated USING (public.is_admin() OR recipient_user_id = auth.uid());
CREATE POLICY "office reads visit tasks" ON public.visit_tasks FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "office reads task recipients" ON public.visit_task_recipients FOR SELECT TO authenticated USING (public.is_admin());

-- 5. Atomic actions
CREATE OR REPLACE FUNCTION public.rc_approve_estimate(_job uuid, _estimate uuid, _expected_job_updated timestamptz, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.jobs; e public.indicative_estimates; a uuid;
BEGIN
  IF NOT public.slice1_enabled() THEN RAISE EXCEPTION 'Slice 1 is switched off'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.updated_at IS DISTINCT FROM _expected_job_updated THEN RAISE EXCEPTION 'Job changed; reload'; END IF;
  SELECT * INTO e FROM public.indicative_estimates WHERE id = _estimate AND job_id = _job AND superseded_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estimate is not current for this job'; END IF;
  UPDATE public.estimate_approvals SET superseded_at = now(), superseded_reason = 'replaced' WHERE job_id = _job AND superseded_at IS NULL;
  UPDATE public.ready_check_requests SET status = 'cancelled' WHERE job_id = _job AND status = 'open';
  INSERT INTO public.estimate_approvals(job_id, estimate_id, approved_by, note) VALUES (_job, _estimate, auth.uid(), _note) RETURNING id INTO a;
  INSERT INTO public.workflow_events(job_id, actor_id, event_type, summary, details, internal)
  VALUES (_job, auth.uid(), 'estimate_approved', 'Office approved the non-binding estimate', jsonb_build_object('approval_id', a, 'estimate_id', _estimate), true);
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public.rc_request_ready_check(_job uuid, _approval uuid, _via text, _consent_version text, _office_evidence text, _idem text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.jobs; r uuid;
BEGIN
  IF NOT public.slice1_enabled() THEN RAISE EXCEPTION 'Slice 1 is switched off'; END IF;
  SELECT id INTO r FROM public.ready_check_requests WHERE idempotency_key = _idem;
  IF FOUND THEN RETURN r; END IF;
  -- Owner-link requests arrive via the server (service_role) after token-hash checks; office-recorded need admin.
  IF _via = 'office_recorded' AND NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF _via = 'owner_link' AND auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Owner link requests come from the secure page only'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.estimate_approvals WHERE id = _approval AND job_id = _job AND superseded_at IS NULL) THEN
    RAISE EXCEPTION 'Estimate approval is not current'; END IF;
  INSERT INTO public.ready_check_requests(job_id, approval_id, requested_via, contact_consent_version, office_evidence, idempotency_key, created_by)
  VALUES (_job, _approval, _via, _consent_version, _office_evidence, _idem, auth.uid()) RETURNING id INTO r;
  INSERT INTO public.workflow_events(job_id, actor_id, event_type, summary, details, internal)
  VALUES (_job, auth.uid(), 'ready_check_requested', 'Free Ready Check requested', jsonb_build_object('request_id', r, 'via', _via), false);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.rc_confirm_time(_visit uuid, _proposal uuid, _proposal_version integer, _party text, _office_evidence text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.visits; p public.appointment_proposals; ja public.job_assignments;
BEGIN
  IF NOT public.slice1_enabled() THEN RAISE EXCEPTION 'Slice 1 is switched off'; END IF;
  SELECT * INTO v FROM public.visits WHERE id = _visit FOR UPDATE;
  IF NOT FOUND OR v.status <> 'time_entered' THEN RAISE EXCEPTION 'Visit is not awaiting confirmation'; END IF;
  SELECT * INTO p FROM public.appointment_proposals WHERE id = _proposal AND visit_id = _visit FOR UPDATE;
  IF NOT FOUND OR p.version <> _proposal_version OR p.status <> 'proposed' THEN RAISE EXCEPTION 'Time changed; reload'; END IF;
  SELECT * INTO ja FROM public.job_assignments WHERE id = v.assignment_id;
  IF NOT ja.active THEN RAISE EXCEPTION 'Assignment is no longer current'; END IF;
  IF _party = 'office' THEN
    IF NOT public.has_role(auth.uid(), 'admin') OR length(trim(coalesce(_office_evidence,''))) = 0 THEN RAISE EXCEPTION 'Office confirmation needs admin and evidence'; END IF;
  ELSIF _party = p.entered_by_party THEN RAISE EXCEPTION 'The other party must confirm';
  ELSIF _party = 'trade' AND auth.uid() IS DISTINCT FROM ja.user_id THEN RAISE EXCEPTION 'Only the assigned trade can confirm';
  ELSIF _party = 'owner' AND NOT public.is_job_owner(v.job_id, auth.uid()) THEN RAISE EXCEPTION 'Only the owner can confirm';
  END IF;
  UPDATE public.appointment_proposals SET status = 'accepted', responded_by = auth.uid(), responded_at = now() WHERE id = _proposal;
  UPDATE public.visits SET status = 'confirmed', confirmed_proposal_id = _proposal, confirmed_at = now(), version = version + 1, updated_at = now() WHERE id = _visit;
  UPDATE public.visit_tasks SET status = 'cancelled' WHERE visit_id = _visit AND status = 'pending';
  INSERT INTO public.workflow_events(job_id, actor_id, event_type, summary, details, internal)
  VALUES (v.job_id, auth.uid(), 'visit_confirmed', 'Ready Check time confirmed', jsonb_build_object('visit_id', _visit, 'proposal_id', _proposal, 'party', _party), false);
  RETURN true;
END $$;

-- 6. Stage guard (active only when the flag is on): no job enters ready_check_scheduled
--    without a confirmed visit for the current active assignment.
CREATE OR REPLACE FUNCTION public.slice1_stage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.stage = 'ready_check_scheduled' AND OLD.stage IS DISTINCT FROM NEW.stage AND public.slice1_enabled()
     AND NOT EXISTS (SELECT 1 FROM public.visits v JOIN public.job_assignments a ON a.id = v.assignment_id
                     WHERE v.job_id = NEW.id AND v.status = 'confirmed' AND a.active) THEN
    RAISE EXCEPTION 'Ready Check is not confirmed for the current assignment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_slice1_stage_guard BEFORE UPDATE OF stage ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.slice1_stage_guard();

REVOKE ALL ON FUNCTION public.rc_approve_estimate(uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rc_request_ready_check(uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rc_confirm_time(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rc_approve_estimate(uuid, uuid, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rc_request_ready_check(uuid, uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rc_confirm_time(uuid, uuid, integer, text, text) TO authenticated, service_role;
