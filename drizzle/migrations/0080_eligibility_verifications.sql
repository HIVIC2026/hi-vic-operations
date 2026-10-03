CREATE TABLE public.eligibility_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('pending','eligible','not_eligible','needs_review')),
  ready_check_ref text NOT NULL,
  ready_check_version integer NOT NULL,
  evidence_complete boolean NOT NULL,
  review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ruleset text NOT NULL,
  reason text,
  note text,
  is_current boolean NOT NULL DEFAULT true,
  supersedes uuid REFERENCES public.eligibility_verifications(id),
  superseded_at timestamptz,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ev_eligible_needs_evidence CHECK (outcome <> 'eligible' OR (evidence_complete AND jsonb_array_length(review_reasons) = 0)),
  CONSTRAINT ev_not_eligible_needs_reason CHECK (outcome <> 'not_eligible' OR length(btrim(coalesce(reason,''))) > 0),
  CONSTRAINT ev_review_needs_note CHECK (outcome NOT IN ('needs_review','pending') OR length(btrim(coalesce(note, reason, ''))) > 0)
);
CREATE UNIQUE INDEX eligibility_verifications_one_current ON public.eligibility_verifications (job_id) WHERE is_current;
GRANT SELECT ON public.eligibility_verifications TO authenticated;
GRANT ALL ON public.eligibility_verifications TO service_role;
ALTER TABLE public.eligibility_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Office reads eligibility verifications" ON public.eligibility_verifications FOR SELECT TO authenticated USING (public.is_admin());
CREATE FUNCTION public.record_eligibility_verification(
  _job uuid, _ref text, _version integer, _outcome text, _evidence_complete boolean,
  _reviews jsonb, _flags jsonb, _snapshot jsonb, _ruleset text, _reason text, _note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _prev uuid; _new uuid; _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN
    RAISE EXCEPTION 'Only office staff can record verified eligibility' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO _prev FROM public.eligibility_verifications WHERE job_id = _job AND is_current FOR UPDATE;
  UPDATE public.eligibility_verifications SET is_current = false, superseded_at = now() WHERE id = _prev;
  INSERT INTO public.eligibility_verifications (job_id, outcome, ready_check_ref, ready_check_version, evidence_complete, review_reasons, flags, evidence_snapshot, ruleset, reason, note, supersedes, recorded_by)
  VALUES (_job, _outcome, _ref, _version, _evidence_complete, coalesce(_reviews,'[]'::jsonb), coalesce(_flags,'[]'::jsonb), coalesce(_snapshot,'{}'::jsonb), _ruleset, nullif(btrim(_reason),''), nullif(btrim(_note),''), _prev, _actor)
  RETURNING id INTO _new;
  INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
  VALUES (_job, _actor, 'eligibility_verified', 'Verified eligibility recorded: ' || _outcome,
    jsonb_build_object('outcome', _outcome, 'verification_id', _new, 'supersedes', _prev, 'ready_check_ref', _ref, 'ready_check_version', _version, 'reason', _reason), true);
  RETURN _new;
END $$;
REVOKE ALL ON FUNCTION public.record_eligibility_verification(uuid, text, integer, text, boolean, jsonb, jsonb, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_eligibility_verification(uuid, text, integer, text, boolean, jsonb, jsonb, jsonb, text, text, text) TO authenticated, service_role;