-- PENDING ONLY. Jo 30 Oct 2026: explicit office-controlled in-house partner configuration.
ALTER TABLE public.businesses
  ADD COLUMN in_house boolean NOT NULL DEFAULT false,
  ADD COLUMN in_house_set_at timestamptz,
  ADD COLUMN in_house_set_by uuid,
  ADD COLUMN rectification_billed_by text NOT NULL DEFAULT 'hivic'
    CHECK (rectification_billed_by IN ('partner', 'hivic'));

UPDATE public.businesses SET in_house = true, in_house_set_at = now()
WHERE id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb');

-- Preserve the old flat $350 arrangement as a business-owned electrical rate-card line.
INSERT INTO public.rate_cards (business_id, kind, name, version, effective_from, is_active)
SELECT b.id, 'electrical', 'In-house PIESA',
  COALESCE((SELECT max(r.version) FROM public.rate_cards r WHERE r.business_id = b.id), 0) + 1,
  current_date, true
FROM public.businesses b
WHERE b.id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb')
AND NOT EXISTS (SELECT 1 FROM public.rate_cards r JOIN public.rate_card_items i ON i.rate_card_id = r.id
  WHERE r.business_id = b.id AND r.is_active AND r.effective_from <= current_date AND lower(i.code) = 'piesa');

INSERT INTO public.rate_card_items (rate_card_id, category, code, description, unit, unit_price_ex_gst, sort)
SELECT r.id, 'electrical', 'PIESA', 'Pre Insulation Electrical Safety Assessment (PIESA)', 'each', 350.0 / 1.1, 0
FROM public.rate_cards r
WHERE r.name = 'In-house PIESA'
AND r.business_id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb')
AND NOT EXISTS (SELECT 1 FROM public.rate_card_items i WHERE i.rate_card_id = r.id AND lower(i.code) = 'piesa');

-- One transaction for the accepted flag/billing values and their permanent history.
-- Only the existing admin-checked saveBusiness handler may invoke this privileged write.
CREATE FUNCTION public.guard_in_house_partner() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF NEW.in_house IS NOT DISTINCT FROM OLD.in_house AND NEW.rectification_billed_by IS NOT DISTINCT FROM OLD.rectification_billed_by THEN RETURN NEW; END IF;
  IF current_user NOT IN ('postgres', 'service_role') AND NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Only the office can change in-house partner configuration';
  END IF;
  actor := COALESCE(NULLIF(current_setting('hivic.in_house_actor', true), '')::uuid, auth.uid());
  IF actor IS NULL THEN RAISE EXCEPTION 'Office actor is required'; END IF;
  NEW.updated_at := now();
  IF NEW.in_house IS DISTINCT FROM OLD.in_house THEN NEW.in_house_set_at := now(); NEW.in_house_set_by := actor; END IF;
  INSERT INTO public.admin_config_events(actor_id, event_type, summary, details)
  VALUES (actor, 'in_house_partner_changed', 'Office changed in-house partner configuration',
    jsonb_build_object('business_id', NEW.id,
      'old', jsonb_build_object('in_house', OLD.in_house, 'rectification_billed_by', OLD.rectification_billed_by),
      'new', jsonb_build_object('in_house', NEW.in_house, 'rectification_billed_by', NEW.rectification_billed_by)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_in_house_partner BEFORE UPDATE OF in_house, rectification_billed_by ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.guard_in_house_partner();

CREATE FUNCTION public.save_in_house_partner(p_business_id uuid, p_in_house boolean,
  p_rectification_billed_by text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE previous public.businesses%ROWTYPE; next_flag boolean; next_billing text;
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Office actor is required'; END IF;
  SELECT * INTO STRICT previous FROM public.businesses WHERE id = p_business_id FOR UPDATE;
  next_flag := COALESCE(p_in_house, previous.in_house);
  next_billing := COALESCE(p_rectification_billed_by, previous.rectification_billed_by);
  IF next_flag IS NOT DISTINCT FROM previous.in_house AND next_billing IS NOT DISTINCT FROM previous.rectification_billed_by THEN RETURN; END IF;
  PERFORM set_config('hivic.in_house_actor', p_actor_id::text, true);
  UPDATE public.businesses SET in_house = next_flag, rectification_billed_by = next_billing,
    in_house_set_at = CASE WHEN next_flag IS DISTINCT FROM previous.in_house THEN now() ELSE in_house_set_at END,
    in_house_set_by = CASE WHEN next_flag IS DISTINCT FROM previous.in_house THEN p_actor_id ELSE in_house_set_by END,
    updated_at = now() WHERE id = p_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_in_house_partner(uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_in_house_partner(uuid, boolean, text, uuid) TO service_role;