-- 0150 — PIESA acceptance must only count a CONFIRMED visit as "already assigned" (P1 UAT DEF-07).
--
-- Defect (observed in UAT on HV-2594, 19 Oct 2026): an electrician tapped one of the owner's PIESA times and was
-- refused with "This job has just been taken.", and their own offer was withdrawn. Nothing had been booked: the
-- business had only been pre-assigned to the job (job_assignments.active = true, booking_confirmed_at IS NULL).
--
-- Root cause: accept_partner_offer() decided "already assigned" from
--     EXISTS (SELECT 1 FROM job_assignments WHERE job_id = o.job_id AND role = 'electrician' AND active)
-- which is true for a pre-assignment that never became a visit. The application layer was already corrected
-- (Brief X: allocation.core.ts piesaOfferBlockers and startPiesaAllocation only count an electrician whose
-- booking_confirmed_at is set), so the database and the app disagreed and the database won.
--
-- Fix: the same rule in SQL. A confirmed visit is the only thing that can take a PIESA away from another
-- electrician. Pre-assignments are ignored, exactly as the app layer ignores them.
--
-- Additive and reversible: CREATE OR REPLACE of one function, identical signature and return shape; no data change.
-- Rollback: 0150_piesa_accept_confirmed_only.rollback.sql.
CREATE OR REPLACE FUNCTION public.accept_partner_offer(_offer uuid, _user uuid)
RETURNS TABLE(outcome text, assignment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  o public.partner_offers%ROWTYPE;
  b public.businesses%ROWTYPE;
  st text;
  pc text;
  aid uuid;
BEGIN
  SELECT * INTO o FROM public.partner_offers WHERE id = _offer FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF o.kind NOT IN ('piesa','rectification') THEN RETURN QUERY SELECT 'wrong_kind'::text, NULL::uuid; RETURN; END IF;
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
  IF coalesce(b.licence_number, b.rec_number) IS NULL THEN RETURN QUERY SELECT 'not_qualified'::text, NULL::uuid; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_workers w WHERE w.business_id = b.id AND w.trade_role = 'electrician'
      AND w.approval_status = 'approved' AND w.removed_at IS NULL) THEN
    RETURN QUERY SELECT 'not_qualified'::text, NULL::uuid; RETURN;
  END IF;
  SELECT j.stage::text, p.postcode INTO st, pc FROM public.jobs j LEFT JOIN public.properties p ON p.id = j.property_id WHERE j.id = o.job_id;
  IF b.coverage_verified_at IS NULL OR pc IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(b.service_postcodes, '{}')) s
       WHERE s = pc OR (right(s, 1) = '*' AND pc LIKE left(s, length(s) - 1) || '%')) THEN
    RETURN QUERY SELECT 'out_of_area'::text, NULL::uuid; RETURN;
  END IF;
  IF (o.kind = 'piesa' AND st <> 'piesa_and_install_window_pending')
     OR (o.kind = 'rectification' AND (st NOT IN ('rectification_scheduling') OR NOT EXISTS (
       SELECT 1 FROM public.quotes q WHERE q.job_id = o.job_id AND q.kind = 'rectification' AND q.status = 'accepted'))) THEN
    RETURN QUERY SELECT 'job_not_ready'::text, NULL::uuid; RETURN;
  END IF;
  -- DEF-07: only a CONFIRMED visit takes the job. A pre-assignment (active, never booked) does not.
  IF EXISTS (SELECT 1 FROM public.job_assignments
              WHERE job_id = o.job_id AND role = 'electrician' AND active
                AND booking_confirmed_at IS NOT NULL) THEN
    UPDATE public.partner_offers SET status = 'withdrawn', superseded_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'already_assigned'::text, NULL::uuid; RETURN;
  END IF;
  INSERT INTO public.job_assignments (job_id, user_id, role, business_id, active, assigned_by)
    VALUES (o.job_id, _user, 'electrician', o.business_id, true, _user) RETURNING id INTO aid;
  UPDATE public.partner_offers SET status = 'accepted', responded_by = _user, responded_at = now() WHERE id = o.id;
  UPDATE public.partner_offers SET status = 'withdrawn', superseded_at = now()
    WHERE job_id = o.job_id AND kind = o.kind AND status = 'pending' AND id <> o.id;
  INSERT INTO public.contact_releases (job_id, assignment_id, visit_kind, released_by, owner_notice, trade_notice) VALUES (o.job_id, aid, o.kind, _user,
    'To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.',
    'Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.')
    ON CONFLICT (assignment_id, visit_kind) DO NOTHING;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal) VALUES
    (o.job_id, _user, 'partner_offer_accepted', 'Electrician accepted the ' || o.kind || ' offer', jsonb_build_object('offer_id', o.id, 'business_id', o.business_id, 'assignment_id', aid), true);
  RETURN QUERY SELECT 'accepted'::text, aid;
END $$;
REVOKE ALL ON FUNCTION public.accept_partner_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_partner_offer(uuid, uuid) TO service_role;
