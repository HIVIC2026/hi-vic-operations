-- Step 11: owner-picked Ready Check windows + installer one-tap booking. Additive only; no existing rows changed.
ALTER TABLE public.partner_offers DROP CONSTRAINT IF EXISTS partner_offers_kind_check;
ALTER TABLE public.partner_offers ADD CONSTRAINT partner_offers_kind_check CHECK (kind IN ('installer', 'piesa', 'rectification', 'ready_check'));

CREATE TABLE IF NOT EXISTS public.ready_check_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  round integer NOT NULL CHECK (round BETWEEN 1 AND 2),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taken', 'closed')),
  taken_offer_id uuid,
  taken_by uuid,
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ready_check_windows TO authenticated;
GRANT ALL ON public.ready_check_windows TO service_role;
ALTER TABLE public.ready_check_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office reads Ready Check windows" ON public.ready_check_windows;
CREATE POLICY "Office reads Ready Check windows" ON public.ready_check_windows FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX IF NOT EXISTS ready_check_windows_job_idx ON public.ready_check_windows(job_id, round);

CREATE OR REPLACE FUNCTION public.accept_ready_check_offer(_offer uuid, _user uuid, _window uuid)
RETURNS TABLE(outcome text, assignment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
DECLARE
  o public.partner_offers%ROWTYPE;
  b public.businesses%ROWTYPE;
  w public.ready_check_windows%ROWTYPE;
  st text; pc text; aid uuid;
BEGIN
  SELECT * INTO o FROM public.partner_offers WHERE id = _offer;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF o.kind <> 'ready_check' THEN RETURN QUERY SELECT 'wrong_kind'::text, NULL::uuid; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('offer:' || o.job_id::text || ':ready_check'));
  SELECT * INTO o FROM public.partner_offers WHERE id = _offer;
  IF o.status <> 'pending' THEN RETURN QUERY SELECT ('already_' || o.status)::text, NULL::uuid; RETURN; END IF;
  IF o.expires_at IS NOT NULL AND o.expires_at < now() THEN
    UPDATE public.partner_offers SET status = 'expired' WHERE id = o.id;
    RETURN QUERY SELECT 'expired'::text, NULL::uuid; RETURN;
  END IF;
  IF _user IS NULL OR NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id = o.business_id AND m.user_id = _user) THEN
    RETURN QUERY SELECT 'not_member'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO b FROM public.businesses WHERE id = o.business_id;
  IF NOT b.is_active OR b.onboarding_status <> 'approved' THEN RETURN QUERY SELECT 'partner_not_approved'::text, NULL::uuid; RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_workers pw
    CROSS JOIN LATERAL (SELECT c.id, c.status FROM public.partner_worker_certifications c
      WHERE c.worker_id = pw.id OR lower(c.worker_email) = lower(pw.email) ORDER BY c.recorded_at DESC LIMIT 1) lc
    CROSS JOIN LATERAL (SELECT l.level, l.expires_on FROM public.worker_certification_levels l
      WHERE l.certification_id = lc.id ORDER BY l.recorded_at DESC LIMIT 1) ll
    WHERE pw.business_id = b.id AND pw.trade_role = 'installer' AND pw.approval_status = 'approved' AND pw.removed_at IS NULL
      AND lc.status = 'verified' AND ll.level = 'full' AND ll.expires_on >= current_date) THEN
    RETURN QUERY SELECT 'not_qualified'::text, NULL::uuid; RETURN;
  END IF;
  SELECT j.stage::text, p.postcode INTO st, pc FROM public.jobs j LEFT JOIN public.properties p ON p.id = j.property_id WHERE j.id = o.job_id;
  IF b.coverage_verified_at IS NULL OR pc IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(b.service_postcodes, '{}')) s WHERE s = pc OR (right(s, 1) = '*' AND pc LIKE left(s, length(s) - 1) || '%')) THEN
    RETURN QUERY SELECT 'out_of_area'::text, NULL::uuid; RETURN;
  END IF;
  IF st <> 'ready_check_ready_to_schedule' THEN RETURN QUERY SELECT 'job_not_ready'::text, NULL::uuid; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.job_assignments ja WHERE ja.job_id = o.job_id AND ja.role = 'installer' AND ja.active) THEN
    UPDATE public.partner_offers SET status = 'withdrawn', superseded_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'already_assigned'::text, NULL::uuid; RETURN;
  END IF;
  IF _window IS NOT NULL THEN
    SELECT * INTO w FROM public.ready_check_windows WHERE id = _window FOR UPDATE;
    IF NOT FOUND OR w.job_id <> o.job_id OR w.status <> 'open' OR w.starts_at <= now() THEN
      RETURN QUERY SELECT 'slot_unavailable'::text, NULL::uuid; RETURN;
    END IF;
  END IF;
  INSERT INTO public.job_assignments (job_id, user_id, role, business_id, active, assigned_by, first_response_at)
    VALUES (o.job_id, _user, 'installer', o.business_id, true, _user, now()) RETURNING id INTO aid;
  UPDATE public.partner_offers SET status = 'accepted', responded_by = _user, responded_at = now() WHERE id = o.id;
  UPDATE public.partner_offers SET status = 'withdrawn', superseded_at = now() WHERE job_id = o.job_id AND kind = 'ready_check' AND status = 'pending' AND id <> o.id;
  IF _window IS NOT NULL THEN
    UPDATE public.ready_check_windows SET status = 'taken', taken_offer_id = o.id, taken_by = _user, taken_at = now() WHERE id = _window;
  END IF;
  UPDATE public.ready_check_windows SET status = 'closed' WHERE job_id = o.job_id AND status = 'open';
  INSERT INTO public.contact_releases (job_id, assignment_id, visit_kind, released_by, owner_notice, trade_notice) VALUES (o.job_id, aid, 'ready_check', _user,
    'To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.',
    'Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.')
    ON CONFLICT (assignment_id, visit_kind) DO NOTHING;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal) VALUES
    (o.job_id, _user, CASE WHEN _window IS NULL THEN 'partner_offer_accepted' ELSE 'ready_check_window_taken' END,
     CASE WHEN _window IS NULL THEN 'Installer accepted the Ready Check offer (time to be arranged)' ELSE 'Installer took one of the owner''s Ready Check times' END,
     jsonb_build_object('offer_id', o.id, 'business_id', o.business_id, 'assignment_id', aid, 'window_id', _window, 'starts_at', w.starts_at), true);
  RETURN QUERY SELECT 'accepted'::text, aid;
END $$;
REVOKE ALL ON FUNCTION public.accept_ready_check_offer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_ready_check_offer(uuid, uuid, uuid) TO service_role;
