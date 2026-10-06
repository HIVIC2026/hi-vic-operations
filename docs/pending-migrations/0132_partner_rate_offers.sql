-- Office counter-offers on a signed partner application's proposed rates. Versioned by round; the
-- partner responds through a separate single-purpose link (only its SHA-256 is stored). Office-only reads.
CREATE TABLE public.partner_rate_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_onboarding_applications(id) ON DELETE RESTRICT,
  round integer NOT NULL CHECK (round >= 1),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'declined', 'superseded')),
  items jsonb NOT NULL,
  note text,
  gst_registered boolean NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  response jsonb,
  UNIQUE (application_id, round)
);
CREATE UNIQUE INDEX partner_rate_offers_one_open ON public.partner_rate_offers (application_id) WHERE status = 'sent';
GRANT ALL ON public.partner_rate_offers TO service_role;
GRANT SELECT ON public.partner_rate_offers TO authenticated;
ALTER TABLE public.partner_rate_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "office reads rate offers" ON public.partner_rate_offers FOR SELECT TO authenticated USING (public.is_admin());

-- Offered figures never change; only the status moves forward once, with the response recorded.
CREATE OR REPLACE FUNCTION public.guard_partner_rate_offer() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF NEW.items IS DISTINCT FROM OLD.items OR NEW.round <> OLD.round OR NEW.application_id <> OLD.application_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.token_hash <> OLD.token_hash
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.gst_registered <> OLD.gst_registered THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF OLD.status <> 'sent' THEN RAISE EXCEPTION 'rate_offer:already_answered'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_rate_offers_guard BEFORE UPDATE OR DELETE ON public.partner_rate_offers FOR EACH ROW EXECUTE FUNCTION public.guard_partner_rate_offer();
