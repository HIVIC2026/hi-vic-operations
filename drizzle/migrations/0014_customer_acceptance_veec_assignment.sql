CREATE TYPE public.assignment_status AS ENUM ('draft','consumer_signed_pending_install','final_details_pending','installer_signed_pending_install','variation_required','effective_complete','cancelled');

-- Versioned compliance wording. Official text is entered by HI VIC; never invented by the portal.
CREATE TABLE public.compliance_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL CHECK (template_key IN ('consumer_declaration','consumer_rights','installer_declaration','ap_declaration')),
  version text NOT NULL,
  body text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  source_note text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, version)
);
CREATE UNIQUE INDEX compliance_templates_one_active ON public.compliance_templates(template_key) WHERE is_active;
GRANT SELECT ON public.compliance_templates TO authenticated;
GRANT ALL ON public.compliance_templates TO service_role;
ALTER TABLE public.compliance_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read approved active templates" ON public.compliance_templates FOR SELECT TO authenticated USING ((approved AND is_active) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_compliance_template() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if tg_op = 'DELETE' then raise exception 'compliance templates are permanent records'; end if;
  if old.approved and (new.body <> old.body or new.version <> old.version or new.template_key <> old.template_key) then
    raise exception 'approved template wording is immutable – create a new version';
  end if;
  return new;
end $$;
CREATE TRIGGER compliance_templates_guard BEFORE UPDATE OR DELETE ON public.compliance_templates FOR EACH ROW EXECUTE FUNCTION public.guard_compliance_template();

-- Customer Acceptance & VEEC Assignment (staged; effective only after eligible install + installer final details).
CREATE TABLE public.customer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  quote_id uuid NOT NULL REFERENCES public.quotes(id),
  quote_version integer NOT NULL,
  status public.assignment_status NOT NULL DEFAULT 'draft',
  ap_legal_entity text NOT NULL,
  signatory_name text,
  signatory_email text,
  signatory_phone text,
  signatory_authority_type text CHECK (signatory_authority_type IN ('owner','authorised_representative')),
  signatory_over_18 boolean,
  assistance_requirement public.assistance_requirement,
  consumer_signature_name text,
  consumer_signed_at timestamptz,
  consumer_signed_by uuid REFERENCES public.profiles(id),
  consumer_ip text,
  consumer_user_agent text,
  consumer_declaration_version text,
  consumer_rights_version text,
  consumer_snapshot jsonb,
  consumer_snapshot_sha256 text,
  consumer_copy_path text,
  copy_sent_at timestamptz,
  quoted_product text,
  quoted_area_m2 numeric,
  price_before_benefit_inc_gst numeric,
  veu_benefit_inc_gst numeric,
  final_customer_price_inc_gst numeric,
  installer_user_id uuid REFERENCES public.profiles(id),
  installer_business_id uuid REFERENCES public.businesses(id),
  installer_name text,
  installer_business_name text,
  installer_abn text,
  installer_licence text,
  installer_declaration_version text,
  installer_signature_name text,
  installer_signed_at timestamptz,
  installer_ip text,
  installer_user_agent text,
  installed_product text,
  installed_area_m2 numeric,
  installer_snapshot jsonb,
  installer_snapshot_sha256 text,
  ap_declaration_version text,
  ap_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  variation_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_at timestamptz,
  completed_at timestamptz,
  final_copy_path text,
  final_copy_at timestamptz,
  retain_until date,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_assignments_one_open ON public.customer_assignments(job_id) WHERE status <> 'cancelled';
CREATE INDEX customer_assignments_job ON public.customer_assignments(job_id);
GRANT SELECT ON public.customer_assignments TO authenticated;
GRANT ALL ON public.customer_assignments TO service_role;
ALTER TABLE public.customer_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin or job owner reads assignment" ON public.customer_assignments FOR SELECT TO authenticated USING (public.is_admin() OR public.is_job_owner(job_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_customer_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if tg_op = 'DELETE' then raise exception 'assignment records are permanent (retain at least 6 years)'; end if;
  if new.job_id <> old.job_id or new.quote_id <> old.quote_id or new.quote_version <> old.quote_version then
    raise exception 'assignment job/quote link is immutable';
  end if;
  if old.consumer_signed_at is not null and (
       new.consumer_snapshot is distinct from old.consumer_snapshot or new.consumer_snapshot_sha256 is distinct from old.consumer_snapshot_sha256
    or new.consumer_signed_at is distinct from old.consumer_signed_at or new.consumer_signature_name is distinct from old.consumer_signature_name
    or new.consumer_signed_by is distinct from old.consumer_signed_by or new.consumer_ip is distinct from old.consumer_ip
    or new.consumer_declaration_version is distinct from old.consumer_declaration_version
    or new.consumer_rights_version is distinct from old.consumer_rights_version
    or new.quoted_product is distinct from old.quoted_product or new.quoted_area_m2 is distinct from old.quoted_area_m2
    or new.price_before_benefit_inc_gst is distinct from old.price_before_benefit_inc_gst
    or new.veu_benefit_inc_gst is distinct from old.veu_benefit_inc_gst
    or new.final_customer_price_inc_gst is distinct from old.final_customer_price_inc_gst
    or new.signatory_name is distinct from old.signatory_name or new.signatory_authority_type is distinct from old.signatory_authority_type) then
    raise exception 'signed consumer snapshot is immutable – use a variation';
  end if;
  if old.installer_signed_at is not null and (
       new.installer_snapshot is distinct from old.installer_snapshot or new.installer_snapshot_sha256 is distinct from old.installer_snapshot_sha256
    or new.installer_signed_at is distinct from old.installer_signed_at or new.installer_signature_name is distinct from old.installer_signature_name
    or new.installed_product is distinct from old.installed_product or new.installed_area_m2 is distinct from old.installed_area_m2) then
    raise exception 'signed installer declaration is immutable';
  end if;
  if old.status in ('effective_complete','cancelled') and new.status <> old.status then
    raise exception 'assignment in a terminal state cannot change status';
  end if;
  new.updated_at = now();
  return new;
end $$;
CREATE TRIGGER customer_assignments_guard BEFORE UPDATE OR DELETE ON public.customer_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_customer_assignment();

-- Variations: original signed snapshot stays on the assignment; each reconfirmation is its own immutable row.
CREATE TABLE public.assignment_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.customer_assignments(id),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  reasons jsonb NOT NULL,
  proposed_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconfirmed','cancelled')),
  raised_by uuid REFERENCES public.profiles(id),
  raised_at timestamptz NOT NULL DEFAULT now(),
  reconfirmed_by uuid REFERENCES public.profiles(id),
  reconfirmed_at timestamptz,
  signature_name text,
  ip_address text,
  user_agent text,
  snapshot_sha256 text,
  resume_status public.assignment_status NOT NULL
);
GRANT SELECT ON public.assignment_variations TO authenticated;
GRANT ALL ON public.assignment_variations TO service_role;
ALTER TABLE public.assignment_variations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin or job owner reads variations" ON public.assignment_variations FOR SELECT TO authenticated USING (public.is_admin() OR public.is_job_owner(job_id, auth.uid()));
CREATE TRIGGER assignment_variations_no_delete BEFORE DELETE ON public.assignment_variations FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

COMMENT ON TABLE public.owner_authorities IS 'DEPRECATED as a pre-assessment gate: replaced by customer_assignments (Customer Acceptance & VEEC Assignment at quote acceptance). Rows retained as permanent history.';

-- Repurpose the owner_authority compliance check label for new jobs (key kept for history).
CREATE OR REPLACE FUNCTION public.seed_job_requirements()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.evidence_requirements (job_id, category, label, gate, responsible_role, required, sort) values
    (new.id,'measurement','Ceiling measurement evidence','assessment','electrician',true,1),
    (new.id,'existing_insulation_r_value','Existing insulation / R-value evidence','assessment','electrician',true,2),
    (new.id,'piesa_signoff','PIESA / electrical safety sign-off','electrical','electrician',true,3),
    (new.id,'rectification_completion','Rectification completion evidence','electrical','electrician',false,4),
    (new.id,'before_ceiling_space','Before: ceiling space','installation','installer',true,5),
    (new.id,'access_manhole','Access / manhole','installation','installer',true,6),
    (new.id,'product_evidence','Product evidence (labels/batch)','installation','installer',true,7),
    (new.id,'installation_progress','Installation progress','installation','installer',false,8),
    (new.id,'completed_installation','Completed installation','installation','installer',true,9),
    (new.id,'installer_declaration','Signed installer declaration','installation','installer',true,10);
  update public.evidence_requirements set status = 'not_required' where job_id = new.id and not required;
  insert into public.compliance_checks (job_id, check_key, label, blocking, sort) values
    (new.id,'eligibility','Property eligibility confirmed',true,1),
    (new.id,'owner_authority','Customer Acceptance & VEEC Assignment effective',true,2),
    (new.id,'owner_consent','Owner quote acceptance recorded',true,3),
    (new.id,'participant_eligibility','Participant eligibility',true,4),
    (new.id,'electrical_assessment','Electrical assessment / PIESA pass',true,5),
    (new.id,'rectification','Rectification complete (if required)',true,6),
    (new.id,'installer_eligibility','Installer eligibility',true,7),
    (new.id,'product_eligibility','Product eligibility',true,8),
    (new.id,'installation_evidence','Installation evidence verified',true,9),
    (new.id,'declarations','Declarations complete',true,10),
    (new.id,'qa','QA review',true,11);
  insert into public.veec_lodgements (job_id) values (new.id);
  return new;
end $function$;

UPDATE public.compliance_checks SET label = 'Customer Acceptance & VEEC Assignment effective' WHERE check_key = 'owner_authority';