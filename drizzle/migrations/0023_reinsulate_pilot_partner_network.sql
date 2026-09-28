-- ReInsulate pilot: partner onboarding, team, credentials, imports, electrician network, appointment coordination, offers, partner pricing.

-- Partner business file
ALTER TABLE public.businesses
  ADD COLUMN legal_name text, ADD COLUMN trading_name text, ADD COLUMN acn text, ADD COLUMN gst_registered boolean,
  ADD COLUMN address text, ADD COLUMN contact_people jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN service_postcodes text[] NOT NULL DEFAULT '{}', ADD COLUMN service_regions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN weekly_capacity integer, ADD COLUMN lead_time_days integer, ADD COLUMN availability_notes text,
  ADD COLUMN installer_certification jsonb NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN rec_number text,
  ADD COLUMN branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN default_comms_owner text NOT NULL DEFAULT 'installer' CHECK (default_comms_owner IN ('installer','hivic')),
  ADD COLUMN commercial_route text NOT NULL DEFAULT 'hivic_full_invoice' CHECK (commercial_route IN ('hivic_full_invoice','split_invoicing')),
  ADD COLUMN onboarding_status text NOT NULL DEFAULT 'draft' CHECK (onboarding_status IN ('draft','submitted','needs_info','approved','suspended','expired')),
  ADD COLUMN onboarding_notes text, ADD COLUMN approved_by uuid REFERENCES public.profiles(id), ADD COLUMN approved_at timestamptz,
  ADD COLUMN xero_contact_status text NOT NULL DEFAULT 'not_ready' CHECK (xero_contact_status IN ('not_ready','ready','synced','error')),
  ADD COLUMN xero_contact_id text, ADD COLUMN xero_contact_error text, ADD COLUMN xero_contact_synced_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN public.businesses.commercial_route IS 'Pilot: only hivic_full_invoice is usable. split_invoicing is configuration-required pending regulatory/commercial verification and is rejected server-side.';

-- Team membership (business admin vs member). profiles.business_id stays the primary link.
CREATE TABLE public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('business_admin','member')),
  active boolean NOT NULL DEFAULT true,
  added_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_business_member(_biz uuid, _admin_only boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (select 1 from public.business_members m where m.business_id = _biz and m.user_id = auth.uid() and m.active and (not _admin_only or m.member_role = 'business_admin'))
      or (not _admin_only and exists (select 1 from public.profiles p where p.id = auth.uid() and p.business_id = _biz))
$$;

GRANT SELECT ON public.business_members TO authenticated;
GRANT ALL ON public.business_members TO service_role;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or own business read members" ON public.business_members FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));

-- Credentials: insurance, licences, registrations, certifications (business or individual)
CREATE TABLE public.business_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  profile_id uuid REFERENCES public.profiles(id),
  kind text NOT NULL CHECK (kind IN ('public_liability_insurance','workers_comp_insurance','other_insurance','electrical_licence','rec_registration','installer_certification','business_registration','other')),
  label text NOT NULL, number text, issuer text, expires_at date,
  critical boolean NOT NULL DEFAULT true,
  document_path text,
  verification text NOT NULL DEFAULT 'pending' CHECK (verification IN ('pending','verified','rejected')),
  verified_by uuid REFERENCES public.profiles(id), verified_at timestamptz,
  created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.business_credentials TO authenticated;
GRANT ALL ON public.business_credentials TO service_role;
ALTER TABLE public.business_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or own business read credentials" ON public.business_credentials FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));

-- Bank details: admin-only table (partners see masked values via server function only)
CREATE TABLE public.business_bank_details (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
  account_name text NOT NULL, bsb text NOT NULL, account_number text NOT NULL,
  updated_by uuid REFERENCES public.profiles(id), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.business_bank_details TO authenticated;
GRANT ALL ON public.business_bank_details TO service_role;
ALTER TABLE public.business_bank_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read bank details" ON public.business_bank_details FOR SELECT TO authenticated USING (public.is_admin());

-- Signed HI VIC / AP participation agreement (immutable)
CREATE TABLE public.partner_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  version text NOT NULL, body text NOT NULL,
  signer_id uuid REFERENCES public.profiles(id), signer_name text NOT NULL, signed_at timestamptz NOT NULL DEFAULT now(),
  ip text, user_agent text, snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_agreements TO authenticated;
GRANT ALL ON public.partner_agreements TO service_role;
ALTER TABLE public.partner_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or own business read agreements" ON public.partner_agreements FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));
CREATE OR REPLACE FUNCTION public.guard_immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin raise exception '% rows are permanent and immutable', tg_table_name; end $$;
CREATE TRIGGER partner_agreements_immutable BEFORE UPDATE OR DELETE ON public.partner_agreements FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_row();

-- Installer <-> electrician relationships
CREATE TABLE public.partner_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installer_business_id uuid NOT NULL REFERENCES public.businesses(id),
  electrician_business_id uuid NOT NULL REFERENCES public.businesses(id),
  preferred boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  notes text, created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installer_business_id, electrician_business_id)
);
GRANT SELECT ON public.partner_relationships TO authenticated;
GRANT ALL ON public.partner_relationships TO service_role;
ALTER TABLE public.partner_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or either business read relationships" ON public.partner_relationships FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(installer_business_id) OR public.is_business_member(electrician_business_id));

-- Nominated (not yet approved) electricians – internal invitation record only while comms are locked
CREATE TABLE public.electrician_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id),
  nominated_by uuid REFERENCES public.profiles(id), nominating_business_id uuid REFERENCES public.businesses(id),
  nominated_for text NOT NULL DEFAULT 'installer' CHECK (nominated_for IN ('installer','customer')),
  contact_name text NOT NULL, business_name text, email text, phone text, licence_number text, rec_number text,
  status text NOT NULL DEFAULT 'invite_pending_comms' CHECK (status IN ('invite_pending_comms','invited','onboarding','approved','declined')),
  business_id uuid REFERENCES public.businesses(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.electrician_nominations TO authenticated;
GRANT ALL ON public.electrician_nominations TO service_role;
ALTER TABLE public.electrician_nominations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or nominating business read nominations" ON public.electrician_nominations FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(nominating_business_id));

-- Job provenance / relationship owner
ALTER TABLE public.jobs
  ADD COLUMN customer_relationship_owner text NOT NULL DEFAULT 'hivic' CHECK (customer_relationship_owner IN ('hivic','installer')),
  ADD COLUMN source_system text, ADD COLUMN external_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN electrician_choice text CHECK (electrician_choice IS NULL OR electrician_choice IN ('preferred','approved_other','nominated','hivic_organise'));
UPDATE public.jobs SET customer_relationship_owner = 'installer' WHERE channel = 'installer_sourced';

-- Imports (draft until confirmed)
CREATE TABLE public.job_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  source_system text NOT NULL DEFAULT 'manual_import' CHECK (source_system IN ('easymate','manual_import','csv','email','api')),
  method text NOT NULL CHECK (method IN ('files','csv','text','reference')),
  external_refs jsonb NOT NULL DEFAULT '{}'::jsonb, source_url text,
  raw_text text, files jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb, extractor_version text NOT NULL DEFAULT 'text-v1',
  confirmed_facts jsonb, confirmed_by uuid REFERENCES public.profiles(id), confirmed_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','discarded')),
  job_id uuid REFERENCES public.jobs(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_imports TO authenticated;
GRANT ALL ON public.job_imports TO service_role;
ALTER TABLE public.job_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or own business read imports" ON public.job_imports FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));

-- Offers of HI VIC jobs to partner installers
CREATE TABLE public.partner_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  offered_by uuid REFERENCES public.profiles(id), offered_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
  responded_by uuid REFERENCES public.profiles(id), responded_at timestamptz, decline_reason text
);
CREATE UNIQUE INDEX partner_offers_one_pending ON public.partner_offers(job_id) WHERE status = 'pending';
GRANT SELECT ON public.partner_offers TO authenticated;
GRANT ALL ON public.partner_offers TO service_role;
ALTER TABLE public.partner_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or offered business read offers" ON public.partner_offers FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));

-- Appointment coordination
CREATE TABLE public.appointment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  kind public.booking_kind NOT NULL DEFAULT 'assessment',
  assignment_id uuid REFERENCES public.job_assignments(id),
  proposed_by uuid NOT NULL REFERENCES public.profiles(id), proposer_role text NOT NULL CHECK (proposer_role IN ('owner','electrician','installer','admin')),
  starts_at timestamptz NOT NULL, ends_at timestamptz, note text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined','superseded','cancelled')),
  responded_by uuid REFERENCES public.profiles(id), responded_at timestamptz, response_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appointment_proposals TO authenticated;
GRANT ALL ON public.appointment_proposals TO service_role;
ALTER TABLE public.appointment_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants read proposals" ON public.appointment_proposals FOR SELECT TO authenticated USING (public.can_access_job(job_id));

ALTER TABLE public.job_assignments ADD COLUMN first_response_at timestamptz, ADD COLUMN booking_confirmed_at timestamptz, ADD COLUMN cannot_attend_at timestamptz;

-- Partner proposed scope/price (supplier cost layer; never shown to owners)
CREATE TABLE public.partner_quote_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  version integer NOT NULL DEFAULT 1,
  rate_card_id uuid REFERENCES public.rate_cards(id),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  supplier_total_ex_gst numeric NOT NULL DEFAULT 0,
  notes text, change_reason text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','superseded','used')),
  snapshot_sha256 text NOT NULL,
  created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_quote_proposals TO authenticated;
GRANT ALL ON public.partner_quote_proposals TO service_role;
ALTER TABLE public.partner_quote_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins or proposing business read proposals" ON public.partner_quote_proposals FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));

ALTER TABLE public.quotes ADD COLUMN partner_business_id uuid REFERENCES public.businesses(id), ADD COLUMN cobrand jsonb;

-- Business admins may read jobs their business is actively assigned to (writes still need an individual assignment).
CREATE OR REPLACE FUNCTION public.can_access_job(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select public.is_admin()
      or public.job_assignment_role(_job, auth.uid()) is not null
      or public.is_job_owner(_job, auth.uid())
      or exists (select 1 from public.job_assignments ja where ja.job_id = _job and ja.active and ja.business_id is not null and public.is_business_member(ja.business_id, true))
$$;