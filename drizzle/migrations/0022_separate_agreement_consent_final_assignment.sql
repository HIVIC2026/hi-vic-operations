-- Activity 48 sequence correction: quote agreement, owner ESC consent, installer declaration and final VEEC assignment are separate records.
ALTER TYPE public.assignment_status ADD VALUE IF NOT EXISTS 'awaiting_installer_signature';
ALTER TYPE public.assignment_status ADD VALUE IF NOT EXISTS 'awaiting_ap_signature';
ALTER TYPE public.assignment_status ADD VALUE IF NOT EXISTS 'awaiting_consumer_signature';

ALTER TABLE public.compliance_templates DROP CONSTRAINT IF EXISTS compliance_templates_template_key_check;
ALTER TABLE public.compliance_templates ADD CONSTRAINT compliance_templates_template_key_check CHECK (template_key = ANY (ARRAY['customer_agreement','consumer_rights','esc_consent','installer_declaration','consumer_declaration','ap_declaration']));
COMMENT ON COLUMN public.compliance_templates.template_key IS 'customer_agreement = AP commercial agreement wording (quote time); consumer_rights = VEU consumer info (quote time); esc_consent = separate ESC owner consent (after booking); installer_declaration = installer declaration (post install); consumer_declaration = OFFICIAL Activity 48 VEEC assignment form (post install, final); ap_declaration = AP declaration if required';

-- 1. Customer Agreement / Quote Acceptance (commercial only; unlocks invoice/deposit).
CREATE TABLE public.customer_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  quote_id uuid NOT NULL REFERENCES public.quotes(id),
  quote_version integer NOT NULL,
  status text NOT NULL DEFAULT 'signed' CHECK (status IN ('signed','superseded','cancelled')),
  record_origin text NOT NULL DEFAULT 'production' CHECK (record_origin IN ('production','legacy_qa')),
  ap_legal_entity text NOT NULL,
  signatory_name text NOT NULL,
  signatory_authority_type text NOT NULL CHECK (signatory_authority_type IN ('owner','authorised_representative')),
  signatory_email text, signatory_phone text,
  signatory_over_18 boolean NOT NULL DEFAULT false,
  assistance_requirement public.assistance_requirement,
  property_address text,
  installer_user_id uuid, installer_business_id uuid, installer_name text, installer_business_name text,
  quoted_product text, quoted_area_m2 numeric,
  price_before_benefit_inc_gst numeric NOT NULL, veu_benefit_inc_gst numeric NOT NULL, final_customer_price_inc_gst numeric NOT NULL,
  payment_terms text,
  rectification_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  consumer_rights_version text, agreement_wording_version text,
  snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL,
  signature_name text NOT NULL, signed_at timestamptz NOT NULL, signed_by uuid REFERENCES public.profiles(id),
  ip text, user_agent text,
  copy_path text,
  retain_until date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_agreements_one_signed ON public.customer_agreements(job_id) WHERE status = 'signed';
GRANT SELECT ON public.customer_agreements TO authenticated;
GRANT ALL ON public.customer_agreements TO service_role;
ALTER TABLE public.customer_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and job owner read agreements" ON public.customer_agreements FOR SELECT TO authenticated USING (public.is_admin() OR public.is_job_owner(job_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_signed_record() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if tg_op = 'DELETE' then raise exception 'signed records are permanent'; end if;
  if tg_table_name = 'customer_agreements' and (new.snapshot is distinct from old.snapshot or new.snapshot_sha256 is distinct from old.snapshot_sha256 or new.signed_at is distinct from old.signed_at or new.signature_name is distinct from old.signature_name or new.quote_id is distinct from old.quote_id) then
    raise exception 'signed customer agreement is immutable';
  end if;
  if tg_table_name = 'installer_declarations' and (new.snapshot is distinct from old.snapshot or new.snapshot_sha256 is distinct from old.snapshot_sha256 or new.signed_at is distinct from old.signed_at) then
    raise exception 'signed installer declaration is immutable';
  end if;
  return new;
end $$;
CREATE TRIGGER customer_agreements_guard BEFORE UPDATE OR DELETE ON public.customer_agreements FOR EACH ROW EXECUTE FUNCTION public.guard_signed_record();

-- 2. Owner ESC information-sharing consent (separate pre-install event, per booking).
CREATE TABLE public.owner_esc_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  booking_id uuid REFERENCES public.bookings(id),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'awaiting_owner' CHECK (status IN ('configuration_required','awaiting_owner','awaiting_ap','valid','stale','cancelled')),
  template_version text,
  ap_legal_entity text NOT NULL,
  scheduled_start timestamptz NOT NULL, scheduled_end timestamptz,
  installation_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  premises_address text NOT NULL,
  owner_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL,
  owner_signatory_name text, owner_authority_type text CHECK (owner_authority_type IS NULL OR owner_authority_type IN ('owner','authorised_representative')),
  owner_signature_name text, owner_signed_at timestamptz, owner_signed_by uuid REFERENCES public.profiles(id), owner_ip text, owner_user_agent text,
  ap_rep_name text, ap_purpose_explained boolean, ap_signed_at timestamptz, ap_signed_by uuid REFERENCES public.profiles(id), ap_ip text, ap_user_agent text,
  signed_sha256 text, copy_path text,
  delivery_status text NOT NULL DEFAULT 'not_ready' CHECK (delivery_status IN ('not_ready','pending_comms_lock','ready_to_send','delivered')),
  stale_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_consent_valid_needs_signatures CHECK (status <> 'valid' OR (owner_signed_at IS NOT NULL AND ap_signed_at IS NOT NULL AND ap_purpose_explained IS TRUE AND template_version IS NOT NULL))
);
CREATE UNIQUE INDEX owner_esc_consents_one_open ON public.owner_esc_consents(job_id) WHERE status NOT IN ('stale','cancelled');
GRANT SELECT ON public.owner_esc_consents TO authenticated;
GRANT ALL ON public.owner_esc_consents TO service_role;
ALTER TABLE public.owner_esc_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and job owner read ESC consents" ON public.owner_esc_consents FOR SELECT TO authenticated USING (public.is_admin() OR public.is_job_owner(job_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_owner_esc_consent() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if tg_op = 'DELETE' then raise exception 'consent records are permanent'; end if;
  if new.snapshot is distinct from old.snapshot or new.snapshot_sha256 is distinct from old.snapshot_sha256 or new.scheduled_start is distinct from old.scheduled_start then
    raise exception 'consent snapshot is immutable – a new consent version is required';
  end if;
  if old.owner_signed_at is not null and (new.owner_signed_at is distinct from old.owner_signed_at or new.owner_signature_name is distinct from old.owner_signature_name) then
    raise exception 'owner consent signature is immutable';
  end if;
  if old.ap_signed_at is not null and (new.ap_signed_at is distinct from old.ap_signed_at or new.ap_rep_name is distinct from old.ap_rep_name) then
    raise exception 'AP consent confirmation is immutable';
  end if;
  if old.status in ('stale','cancelled') and new.status <> old.status then raise exception 'stale/cancelled consent cannot be revived'; end if;
  new.updated_at = now();
  return new;
end $$;
CREATE TRIGGER owner_esc_consents_guard BEFORE UPDATE OR DELETE ON public.owner_esc_consents FOR EACH ROW EXECUTE FUNCTION public.guard_owner_esc_consent();

-- 3. Installer declaration (post install, before AP review) – structured installed facts.
CREATE TABLE public.installer_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  installer_user_id uuid REFERENCES public.profiles(id), installer_business_id uuid REFERENCES public.businesses(id),
  installer_name text, installer_business_name text, installer_abn text, installer_licence text,
  template_version text NOT NULL,
  installed_product text NOT NULL, installed_r_value text, installed_area_m2 numeric NOT NULL CHECK (installed_area_m2 > 0),
  zones jsonb NOT NULL DEFAULT '[]'::jsonb, field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL,
  signature_name text NOT NULL, signed_at timestamptz NOT NULL, signed_by uuid REFERENCES public.profiles(id), ip text, user_agent text,
  status text NOT NULL DEFAULT 'signed' CHECK (status IN ('signed','superseded')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX installer_declarations_one_signed ON public.installer_declarations(job_id) WHERE status = 'signed';
GRANT SELECT ON public.installer_declarations TO authenticated;
GRANT ALL ON public.installer_declarations TO service_role;
ALTER TABLE public.installer_declarations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and assigned installer read installer declarations" ON public.installer_declarations FOR SELECT TO authenticated USING (public.is_admin() OR installer_user_id = auth.uid());
CREATE TRIGGER installer_declarations_guard BEFORE UPDATE OR DELETE ON public.installer_declarations FOR EACH ROW EXECUTE FUNCTION public.guard_signed_record();

-- 4. customer_assignments becomes the FINAL post-install Activity 48 VEEC assignment.
ALTER TABLE public.customer_assignments ADD COLUMN record_kind text NOT NULL DEFAULT 'final_veec_assignment' CHECK (record_kind IN ('legacy_quote_time','final_veec_assignment'));
ALTER TABLE public.customer_assignments ADD COLUMN customer_agreement_id uuid REFERENCES public.customer_agreements(id);
ALTER TABLE public.customer_assignments ADD COLUMN installer_declaration_id uuid REFERENCES public.installer_declarations(id);
ALTER TABLE public.customer_assignments ADD COLUMN final_facts jsonb;
ALTER TABLE public.customer_assignments ADD COLUMN final_facts_sha256 text;
ALTER TABLE public.customer_assignments ADD COLUMN installed_r_value text;
ALTER TABLE public.customer_assignments ADD COLUMN prepared_at timestamptz;
ALTER TABLE public.customer_assignments ADD COLUMN delivery_status text NOT NULL DEFAULT 'not_ready' CHECK (delivery_status IN ('not_ready','pending_comms_lock','ready_to_send','delivered'));
COMMENT ON COLUMN public.customer_assignments.esc_consent_version IS 'DEPRECATED: ESC consent now lives in owner_esc_consents';
COMMENT ON COLUMN public.customer_assignments.esc_consent_signed_at IS 'DEPRECATED: ESC consent now lives in owner_esc_consents';
COMMENT ON COLUMN public.customer_assignments.record_kind IS 'legacy_quote_time = pre-correction record signed at quote acceptance (history only, never effective for VEEC); final_veec_assignment = post-install official assignment';
DROP INDEX IF EXISTS public.customer_assignments_one_open;
CREATE UNIQUE INDEX customer_assignments_one_open ON public.customer_assignments(job_id, record_kind) WHERE status <> 'cancelled';

CREATE OR REPLACE FUNCTION public.guard_final_facts() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if (old.installer_signed_at is not null or old.ap_signed_at is not null or old.consumer_signed_at is not null)
     and (new.final_facts is distinct from old.final_facts or new.final_facts_sha256 is distinct from old.final_facts_sha256 or new.record_kind is distinct from old.record_kind) then
    raise exception 'final assignment facts are immutable once any party has signed – prepare a new version';
  end if;
  return new;
end $$;
CREATE TRIGGER customer_assignments_guard_final BEFORE UPDATE ON public.customer_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_final_facts();

-- 5. ESC notification now references the separate consent; sent requires consent.
ALTER TABLE public.esc_notifications ADD COLUMN consent_id uuid REFERENCES public.owner_esc_consents(id);
ALTER TABLE public.esc_notifications ADD COLUMN earliest_send_at timestamptz;
COMMENT ON COLUMN public.esc_notifications.consent_assignment_id IS 'DEPRECATED: replaced by consent_id (owner_esc_consents)';
ALTER TABLE public.esc_notifications ADD CONSTRAINT esc_sent_needs_consent CHECK (status NOT IN ('sent','accepted') OR consent_id IS NOT NULL);