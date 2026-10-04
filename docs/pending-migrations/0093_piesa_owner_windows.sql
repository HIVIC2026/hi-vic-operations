-- Step 6: owner-picked PIESA windows; an electrician tapping a window accepts the offer AND takes that window.
-- Additive only: one nullable column, one index, one new function. accept_partner_offer is unchanged (fallback path).
ALTER TABLE public.appointment_proposals ADD COLUMN IF NOT EXISTS piesa_window_round integer;
COMMENT ON COLUMN public.appointment_proposals.piesa_window_round IS 'Owner-picked PIESA window round (1 or 2). Null for ordinary proposals.';
CREATE INDEX IF NOT EXISTS appointment_proposals_piesa_windows_idx ON public.appointment_proposals(job_id, piesa_window_round) WHERE piesa_window_round IS NOT NULL;

CREATE OR REPLACE FUNCTION public.accept_partner_offer_slot(_offer uuid, _user uuid, _proposal uuid)
RETURNS TABLE(outcome text, assignment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  p public.appointment_proposals%ROWTYPE;
  oj uuid;
  res record;
BEGIN
  SELECT job_id INTO oj FROM public.partner_offers WHERE id = _offer;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  SELECT * INTO p FROM public.appointment_proposals WHERE id = _proposal FOR UPDATE;
  IF NOT FOUND OR p.job_id <> oj OR p.piesa_window_round IS NULL OR p.kind <> 'assessment'
     OR p.status <> 'proposed' OR p.starts_at <= now() THEN
    RETURN QUERY SELECT 'slot_unavailable'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO res FROM public.accept_partner_offer(_offer, _user);
  IF res.outcome <> 'accepted' THEN RETURN QUERY SELECT res.outcome, NULL::uuid; RETURN; END IF;
  UPDATE public.appointment_proposals SET status = 'accepted', assignment_id = res.assignment_id, responded_by = _user, responded_at = now()
    WHERE id = p.id;
  UPDATE public.appointment_proposals SET status = 'superseded'
    WHERE job_id = p.job_id AND piesa_window_round IS NOT NULL AND status = 'proposed' AND id <> p.id;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal) VALUES
    (p.job_id, _user, 'piesa_window_taken', 'Electrician took one of the owner''s PIESA times', jsonb_build_object('offer_id', _offer, 'proposal_id', p.id, 'starts_at', p.starts_at), true);
  RETURN QUERY SELECT 'accepted'::text, res.assignment_id;
END $$;
REVOKE ALL ON FUNCTION public.accept_partner_offer_slot(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_partner_offer_slot(uuid, uuid, uuid) TO service_role;
