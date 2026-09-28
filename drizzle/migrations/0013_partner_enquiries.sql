CREATE TABLE public.partner_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_type text NOT NULL CHECK (enquiry_type IN ('property_manager','installer','electrician_rec')),
  external_id text,
  submission_id text NOT NULL,
  source_system text NOT NULL DEFAULT 'base44',
  source text,
  source_status text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','onboarding','approved','declined','closed')),
  name text, email text, phone text, company text,
  property_count integer,
  service_areas text[],
  cii_certification_status text,
  cii_certification_details text,
  estimated_r5_install_rate_per_sqm_inc_gst numeric,
  rec_registration_number text,
  esv_licensed_electricians_confirmed boolean,
  services text[],
  estimated_piesa_fee_inc_gst numeric,
  estimated_return_visit_fee_inc_gst numeric,
  booking_lead_time text,
  weekly_capacity text,
  notes text,
  internal_notes text,
  raw_payload jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  contacted_at timestamptz, approved_at timestamptz, declined_at timestamptz,
  status_changed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_enquiries_source_key UNIQUE (source_system, enquiry_type, submission_id)
);
CREATE UNIQUE INDEX partner_enquiries_external_id_key ON public.partner_enquiries (source_system, external_id) WHERE external_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_enquiries TO authenticated;
GRANT ALL ON public.partner_enquiries TO service_role;
ALTER TABLE public.partner_enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read partner enquiries" ON public.partner_enquiries FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins update partner enquiries" ON public.partner_enquiries FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER partner_enquiries_touch BEFORE UPDATE ON public.partner_enquiries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();