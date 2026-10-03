-- PIESA electrician allocation + direct self-scheduling. Additive / backward-compatible only.
--  * partner_offers gains kind/batch/superseded_at (existing rows stay installer offers)
--  * workflow_settings gains configurable REC offer expiry (default 2h) and batch size (default 3)
--  * contact_releases: one audited, job- and visit-scoped release per active assignment; owners
--    are readable by a trade only through an active release (existing active assignments backfilled)
--  * piesa_records gains rectification_completed_at / section_c_signed_at (30-day timing source)
--  * quotes gains office_reviewed_at/by (rectification quotes are office-reviewed before issue)
--  * accept_partner_offer(): atomic first-valid-acceptance for PIESA/rectification offers

ALTER TABLE public.partner_offers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'installer';
ALTER TABLE public.partner_offers ADD COLUMN IF NOT EXISTS batch integer NOT NULL DEFAULT 1;
ALTER TABLE public.partner_offers ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.partner_offers ADD CONSTRAINT partner_offers_kind_check CHECK (kind IN ('installer','piesa','rectification'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS partner_offers_job_kind_status_idx ON public.partner_offers (job_id, kind, status);

ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS rec_offer_expiry_hours numeric NOT NULL DEFAULT 2;
ALTER TABLE public.workflow_settings ADD COLUMN IF NOT EXISTS rec_offer_batch_size integer NOT NULL DEFAULT 3;

ALTER TABLE public.piesa_records ADD COLUMN IF NOT EXISTS rectification_completed_at timestamptz;
ALTER TABLE public.piesa_records ADD COLUMN IF NOT EXISTS section_c_signed_at timestamptz;

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS office_reviewed_at timestamptz;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS office_reviewed_by uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.contact_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.job_assignments(id) ON DELETE CASCADE,
  visit_kind text NOT NULL CHECK (visit_kind IN ('ready_check','piesa','rectification','installation')),
  released_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  owner_notice text NOT NULL,
  trade_notice text NOT NULL,
  UNIQUE (assignment_id, visit_kind)
);
GRANT SELECT ON public.contact_releases TO authenticated;
GRANT ALL ON public.contact_releases TO service_role;
ALTER TABLE public.contact_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins or job participants read releases" ON public.contact_releases;
CREATE POLICY "Admins or job participants read releases" ON public.contact_releases FOR SELECT TO authenticated
  USING (public.is_admin() OR public.can_access_job(job_id));

CREATE OR REPLACE FUNCTION public.has_contact_release(_job uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contact_releases r JOIN public.job_assignments a ON a.id = r.assignment_id
    WHERE r.job_id = _job AND a.user_id = _user AND a.active AND r.revoked_at IS NULL)
$$;

-- Release follows the assignment: revoked automatically when the assignment ends.
CREATE OR REPLACE FUNCTION public.revoke_contact_release_on_end()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    UPDATE public.contact_releases SET revoked_at = now() WHERE assignment_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS job_assignments_revoke_release ON public.job_assignments;
CREATE TRIGGER job_assignments_revoke_release AFTER UPDATE OF active ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.revoke_contact_release_on_end();

-- Every new assignment (any existing assignment path) gets its job-only, audited release.
CREATE OR REPLACE FUNCTION public.release_contact_on_assign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text := CASE WHEN NEW.role = 'installer' THEN 'ready_check' ELSE 'piesa' END;
BEGIN
  IF NEW.active AND NEW.role IN ('installer','electrician') THEN
    INSERT INTO public.contact_releases (job_id, assignment_id, visit_kind, released_by, owner_notice, trade_notice) VALUES (NEW.job_id, NEW.id, v, NEW.assigned_by,
      'To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.',
      'Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.')
    ON CONFLICT (assignment_id, visit_kind) DO NOTHING;
    INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
      VALUES (NEW.job_id, NEW.assigned_by, 'contact_released', 'Owner and ' || NEW.role || ' contact details released for this job only', jsonb_build_object('assignment_id', NEW.id, 'visit_kind', v), true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS job_assignments_release_contact ON public.job_assignments;
CREATE TRIGGER job_assignments_release_contact AFTER INSERT ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.release_contact_on_assign();

-- Backfill: every currently active assignment keeps the owner visibility it already has.
INSERT INTO public.contact_releases (job_id, assignment_id, visit_kind, released_at, owner_notice, trade_notice)
SELECT a.job_id, a.id, CASE WHEN a.role = 'installer' THEN 'ready_check' ELSE 'piesa' END, a.assigned_at,
  'To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.',
  'Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.'
FROM public.job_assignments a WHERE a.active
ON CONFLICT (assignment_id, visit_kind) DO NOTHING;

-- Owner contact rows: own row, or an assigned trade with an active audited release for that job.
DROP POLICY IF EXISTS owner_or_assignee ON public.owners;
CREATE POLICY owner_or_assignee ON public.owners FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.owner_id = owners.id AND public.has_contact_release(j.id, auth.uid())));

-- Atomic acceptance. First valid acceptance wins; competing open offers are superseded.
CREATE OR REPLACE FUNCTION public.accept_partner_offer(_offer uuid, _user uuid)
RETURNS TABLE(outcome text, assignment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  o public.partner_offers%ROWTYPE;
  b public.businesses%ROWTYPE;
  aid uuid;
  visit text;
BEGIN
  SELECT * INTO o FROM public.partner_offers WHERE id = _offer FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF o.kind NOT IN ('piesa','rectification') THEN RETURN QUERY SELECT 'wrong_kind'::text, NULL::uuid; RETURN; END IF;
  -- Serialise every acceptance for this job + kind.
  PERFORM pg_advisory_xact_lock(hashtext('offer:' || o.job_id::text || ':' || o.kind));
  SELECT * INTO o FROM public.partner_offers WHERE id = _offer;
  IF o.status <> 'pending' THEN RETURN QUERY SELECT ('already_' || o.status)::text, NULL::uuid; RETURN; END IF;
  IF o.expires_at IS NOT NULL AND o.expires_at < now() THEN
    UPDATE public.partner_offers SET status = 'expired' WHERE id = o.id;
    RETURN QUERY SELECT 'expired'::text, NULL::uuid; RETURN;
  END IF;
  IF _user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_members m WHERE m.business_id = o.business_id AND m.user_id = _user) THEN
    RETURN QUERY SELECT 'not_member'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO b FROM public.businesses WHERE id = o.business_id;
  IF NOT b.is_active OR b.onboarding_status <> 'approved' THEN RETURN QUERY SELECT 'partner_not_approved'::text, NULL::uuid; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.job_assignments WHERE job_id = o.job_id AND role = 'electrician' AND active) THEN
    UPDATE public.partner_offers SET status = 'withdrawn', superseded_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'already_assigned'::text, NULL::uuid; RETURN;
  END IF;
  INSERT INTO public.job_assignments (job_id, user_id, role, business_id, active, assigned_by)
    VALUES (o.job_id, _user, 'electrician', o.business_id, true, _user) RETURNING id INTO aid;
  UPDATE public.partner_offers SET status = 'accepted', responded_by = _user, responded_at = now() WHERE id = o.id;
  UPDATE public.partner_offers SET status = 'withdrawn', superseded_at = now()
    WHERE job_id = o.job_id AND kind = o.kind AND status = 'pending' AND id <> o.id;
  visit := o.kind;
  INSERT INTO public.contact_releases (job_id, assignment_id, visit_kind, released_by, owner_notice, trade_notice) VALUES (o.job_id, aid, visit, _user,
    'To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.',
    'Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.')
    ON CONFLICT (assignment_id, visit_kind) DO NOTHING;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal) VALUES
    (o.job_id, _user, 'partner_offer_accepted', 'Electrician accepted the ' || o.kind || ' offer', jsonb_build_object('offer_id', o.id, 'business_id', o.business_id, 'assignment_id', aid), true);
  RETURN QUERY SELECT 'accepted'::text, aid;
END $$;
REVOKE ALL ON FUNCTION public.accept_partner_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_partner_offer(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.has_contact_release(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_contact_release(uuid, uuid) TO authenticated, service_role;
