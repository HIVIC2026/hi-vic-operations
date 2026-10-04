-- Rectification (Operating Model v2): electrician's estimated hours + 3-5 windows; owner approves the quote and
-- picks one window in ONE locked step. Additive only; existing rows unchanged (new columns empty / false).
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS rect_estimated_hours numeric;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS nudge_24h_at timestamptz;
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_rect_estimated_hours_range;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_rect_estimated_hours_range CHECK (rect_estimated_hours IS NULL OR (rect_estimated_hours > 0 AND rect_estimated_hours <= 100));
ALTER TABLE public.appointment_proposals ADD COLUMN IF NOT EXISTS electrician_window boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.quotes.rect_estimated_hours IS 'Electrician estimate of rectification hours, given at PIESA submit.';
COMMENT ON COLUMN public.quotes.nudge_24h_at IS 'Rectification quote: 24h owner reminder queued at (day 3 reuses nudge_day3_at).';
COMMENT ON COLUMN public.appointment_proposals.electrician_window IS 'Rectification window offered by the electrician at PIESA submit; the owner picks one when approving the quote.';

CREATE OR REPLACE FUNCTION public.approve_rectification_with_window(_quote uuid, _proposal uuid, _user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record; p record;
BEGIN
  SELECT id, job_id, kind::text AS kind, status::text AS status INTO q FROM public.quotes WHERE id = _quote FOR UPDATE;
  IF q.id IS NULL OR q.kind <> 'rectification' OR q.status <> 'issued' THEN RAISE EXCEPTION 'This quote is no longer open.'; END IF;
  SELECT id, job_id, kind::text AS kind, status, starts_at, electrician_window INTO p FROM public.appointment_proposals WHERE id = _proposal FOR UPDATE;
  IF p.id IS NULL OR p.job_id <> q.job_id OR p.kind <> 'rectification' OR NOT p.electrician_window THEN RAISE EXCEPTION 'That time is not one of the electrician''s times.'; END IF;
  IF p.status <> 'proposed' THEN RAISE EXCEPTION 'That time is no longer available.'; END IF;
  IF p.starts_at < now() + interval '24 hours' THEN RAISE EXCEPTION 'That time is less than 24 hours away.'; END IF;
  UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = _user WHERE id = _quote;
  UPDATE public.appointment_proposals SET status = 'accepted', responded_by = _user, responded_at = now(),
    response_note = 'Owner picked this time when approving the rectification quote' WHERE id = _proposal;
  UPDATE public.appointment_proposals SET status = 'superseded'
    WHERE job_id = q.job_id AND electrician_window AND status = 'proposed' AND id <> _proposal;
  RETURN p.id;
END $$;
REVOKE ALL ON FUNCTION public.approve_rectification_with_window(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_rectification_with_window(uuid, uuid, uuid) TO service_role;
