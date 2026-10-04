-- 0090 Office-only "discard draft" for electrician rates. Additive: new 'discarded' status, guard update, discard function.
ALTER TABLE public.electrician_rates DROP CONSTRAINT IF EXISTS electrician_rates_status_check;
ALTER TABLE public.electrician_rates ADD CONSTRAINT electrician_rates_status_check CHECK (status IN ('draft','active','superseded','expired','discarded'));
ALTER TABLE public.electrician_rates DROP CONSTRAINT IF EXISTS electrician_rates_approved;
ALTER TABLE public.electrician_rates ADD CONSTRAINT electrician_rates_approved CHECK (status IN ('draft','discarded') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.guard_electrician_rate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electrician rates are permanent records; discard a draft instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','active') THEN RAISE EXCEPTION 'New electrician rates start as draft or active'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('superseded','expired','discarded') THEN RAISE EXCEPTION 'Superseded, expired or discarded electrician rates cannot be changed'; END IF;
  IF NEW.status = 'discarded' AND OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft rate can be discarded'; END IF;
  IF OLD.status = 'active' THEN
    IF NEW.status NOT IN ('active','superseded','expired') THEN RAISE EXCEPTION 'An active rate can only be superseded or expired'; END IF;
    IF (NEW.business_id, NEW.service_type, NEW.rate_inc_gst, NEW.effective_from, NEW.approved_by, NEW.approved_at, NEW.source_note)
       IS DISTINCT FROM (OLD.business_id, OLD.service_type, OLD.rate_inc_gst, OLD.effective_from, OLD.approved_by, OLD.approved_at, OLD.source_note)
    THEN RAISE EXCEPTION 'Active electrician rates cannot be edited; create a new rate instead'; END IF;
  END IF;
  IF OLD.status = 'draft' AND NEW.status IN ('superseded','expired') THEN RAISE EXCEPTION 'A draft rate can only be activated or discarded'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.discard_electrician_rate(_rate_id uuid, _actor uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.electrician_rates;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'Only office can discard electrician rates'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'A reason is required to discard a draft rate'; END IF;
  SELECT * INTO r FROM public.electrician_rates WHERE id = _rate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rate not found'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft rate can be discarded'; END IF;
  UPDATE public.electrician_rates SET status = 'discarded' WHERE id = _rate_id;
  INSERT INTO public.electrician_rate_events(rate_id, actor_id, event_type, details)
    VALUES (_rate_id, _actor, 'discarded', jsonb_build_object('reason', btrim(_reason), 'rate_inc_gst', r.rate_inc_gst, 'service_type', r.service_type));
END $$;
REVOKE ALL ON FUNCTION public.discard_electrician_rate(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_electrician_rate(uuid, uuid, text) TO service_role;
