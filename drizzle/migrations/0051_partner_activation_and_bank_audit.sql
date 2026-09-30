CREATE TABLE public.partner_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.rec_onboarding_applications(id),
  partner_enquiry_id uuid NOT NULL REFERENCES public.partner_enquiries(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  partner_type text NOT NULL CHECK (partner_type IN ('rec','installer')),
  rate_card_id uuid NOT NULL REFERENCES public.rate_cards(id),
  activated_by uuid NOT NULL REFERENCES public.profiles(id),
  override_reason text,
  snapshot jsonb NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_activations TO authenticated;
GRANT ALL ON public.partner_activations TO service_role;
ALTER TABLE public.partner_activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or activated business read partner activations" ON public.partner_activations FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));
CREATE TRIGGER partner_activations_immutable BEFORE UPDATE OR DELETE ON public.partner_activations FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

ALTER TABLE public.business_bank_details
  ADD COLUMN supplied_by uuid REFERENCES public.profiles(id),
  ADD COLUMN supplied_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed'));

CREATE TABLE public.business_bank_detail_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  event_type text NOT NULL CHECK (event_type IN ('supplied','changed','reviewed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.business_bank_detail_events TO authenticated;
GRANT ALL ON public.business_bank_detail_events TO service_role;
ALTER TABLE public.business_bank_detail_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read bank detail events" ON public.business_bank_detail_events FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER business_bank_detail_events_immutable BEFORE UPDATE OR DELETE ON public.business_bank_detail_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();