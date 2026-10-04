-- 0089 Electrician agreed rates (office-only rate card per REC business). Additive only.
-- One row per (business, service, version). Only one ACTIVE row per business+service.
-- Active rows are frozen: amount/service/business/effective_from never change; they can only be superseded or expired.
-- Offers snapshot the rate into partner_offers.summary, so later rate changes never alter historical offers.

CREATE TABLE public.electrician_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  service_type text NOT NULL CHECK (service_type IN ('piesa','rectification_visit','section_c_signoff','installation_attendance')),
  rate_inc_gst numeric(10,2) NOT NULL CHECK (rate_inc_gst >= 0),
  gst_included boolean NOT NULL DEFAULT true CHECK (gst_included),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded','expired')),
  approved_by uuid,
  approved_at timestamptz,
  source_note text NOT NULL CHECK (length(btrim(source_note)) >= 3),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT electrician_rates_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT electrician_rates_approved CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX electrician_rates_one_active ON public.electrician_rates(business_id, service_type) WHERE status = 'active';
CREATE INDEX electrician_rates_business ON public.electrician_rates(business_id);

CREATE TABLE public.electrician_rate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_id uuid NOT NULL REFERENCES public.electrician_rates(id) ON DELETE RESTRICT,
  actor_id uuid,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.electrician_rates TO authenticated;
GRANT ALL ON public.electrician_rates TO service_role;
GRANT SELECT ON public.electrician_rate_events TO authenticated;
GRANT ALL ON public.electrician_rate_events TO service_role;

ALTER TABLE public.electrician_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electrician_rate_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Office manages electrician rates" ON public.electrician_rates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Electricians read own active rates" ON public.electrician_rates FOR SELECT TO authenticated
  USING (status = 'active' AND public.is_business_member(business_id, false));
CREATE POLICY "Office reads rate history" ON public.electrician_rate_events FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE FUNCTION public.guard_electrician_rate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Approved electrician rates are permanent records'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','active') THEN RAISE EXCEPTION 'New electrician rates start as draft or active'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('superseded','expired') THEN RAISE EXCEPTION 'Superseded or expired electrician rates cannot be changed'; END IF;
  IF OLD.status = 'active' THEN
    IF NEW.status NOT IN ('active','superseded','expired') THEN RAISE EXCEPTION 'An active rate can only be superseded or expired'; END IF;
    IF (NEW.business_id, NEW.service_type, NEW.rate_inc_gst, NEW.effective_from, NEW.approved_by, NEW.approved_at, NEW.source_note)
       IS DISTINCT FROM (OLD.business_id, OLD.service_type, OLD.rate_inc_gst, OLD.effective_from, OLD.approved_by, OLD.approved_at, OLD.source_note)
    THEN RAISE EXCEPTION 'Active electrician rates cannot be edited; create a new rate instead'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER electrician_rate_guard BEFORE INSERT OR UPDATE OR DELETE ON public.electrician_rates FOR EACH ROW EXECUTE FUNCTION public.guard_electrician_rate();

CREATE FUNCTION public.guard_electrician_rate_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Electrician rate history is append-only'; END $$;
CREATE TRIGGER electrician_rate_event_guard BEFORE UPDATE OR DELETE ON public.electrician_rate_events FOR EACH ROW EXECUTE FUNCTION public.guard_electrician_rate_event();

-- Atomic activation: supersedes the current active rate for the same business+service, then activates this draft.
CREATE FUNCTION public.activate_electrician_rate(_rate_id uuid, _actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.electrician_rates; prev uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'Only office can activate electrician rates'; END IF;
  SELECT * INTO r FROM public.electrician_rates WHERE id = _rate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rate not found'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft rate can be activated'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('elec_rate:' || r.business_id::text || ':' || r.service_type));
  UPDATE public.electrician_rates SET status = 'superseded', effective_to = coalesce(effective_to, greatest(effective_from, r.effective_from - 1))
    WHERE business_id = r.business_id AND service_type = r.service_type AND status = 'active' RETURNING id INTO prev;
  IF prev IS NOT NULL THEN
    INSERT INTO public.electrician_rate_events(rate_id, actor_id, event_type, details) VALUES (prev, _actor, 'superseded', jsonb_build_object('by', _rate_id));
  END IF;
  UPDATE public.electrician_rates SET status = 'active', approved_by = _actor, approved_at = now() WHERE id = _rate_id;
  INSERT INTO public.electrician_rate_events(rate_id, actor_id, event_type, details) VALUES (_rate_id, _actor, 'activated', jsonb_build_object('rate_inc_gst', r.rate_inc_gst, 'service_type', r.service_type, 'supersedes', prev));
  RETURN prev;
END $$;
REVOKE ALL ON FUNCTION public.activate_electrician_rate(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_electrician_rate(uuid, uuid) TO service_role;
