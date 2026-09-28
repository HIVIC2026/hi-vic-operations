ALTER TABLE public.compliance_templates ADD COLUMN IF NOT EXISTS form_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.compliance_templates.form_fields IS 'Structured fields the electronic form renders (separate from static official wording in body).';
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS installer_form_values jsonb;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS ap_signed_at timestamptz;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS ap_signed_by uuid;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS ap_signature_name text;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS ap_snapshot_sha256 text;

CREATE OR REPLACE FUNCTION public.guard_compliance_template()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'compliance templates are permanent records'; end if;
  if old.approved and (new.body <> old.body or new.version <> old.version or new.template_key <> old.template_key or new.form_fields is distinct from old.form_fields) then
    raise exception 'approved template wording/fields are immutable – create a new version';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_ap_signature()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if old.ap_signed_at is not null and (new.ap_signed_at is distinct from old.ap_signed_at or new.ap_signature_name is distinct from old.ap_signature_name
     or new.ap_signed_by is distinct from old.ap_signed_by or new.ap_snapshot_sha256 is distinct from old.ap_snapshot_sha256) then
    raise exception 'signed AP declaration is immutable';
  end if;
  if old.installer_signed_at is not null and new.installer_form_values is distinct from old.installer_form_values then
    raise exception 'signed installer declaration is immutable';
  end if;
  return new;
end $function$;
DROP TRIGGER IF EXISTS customer_assignments_guard_ap ON public.customer_assignments;
CREATE TRIGGER customer_assignments_guard_ap BEFORE UPDATE ON public.customer_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_ap_signature();