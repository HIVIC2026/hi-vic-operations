CREATE TABLE public.partner_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  trade_role public.assignment_role NOT NULL,
  full_legal_name text NOT NULL,
  email text NOT NULL,
  mobile text,
  licence_number text,
  qualification text,
  source_application_id uuid REFERENCES public.rec_onboarding_applications(id),
  account_status text NOT NULL DEFAULT 'awaiting_account' CHECK (account_status IN ('awaiting_account','linked','disabled')),
  linked_by uuid REFERENCES public.profiles(id),
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, email),
  UNIQUE (profile_id),
  CHECK ((trade_role = 'electrician' AND licence_number IS NOT NULL) OR (trade_role = 'installer' AND qualification IS NOT NULL) OR trade_role = 'property_manager')
);
GRANT SELECT ON public.partner_workers TO authenticated;
GRANT ALL ON public.partner_workers TO service_role;
ALTER TABLE public.partner_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or own business read workers" ON public.partner_workers FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));
CREATE TRIGGER t_partner_workers BEFORE UPDATE ON public.partner_workers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
COMMENT ON TABLE public.partner_workers IS 'Nominated trade workers from signed partner onboarding, linked to individual portal profiles after account creation.';