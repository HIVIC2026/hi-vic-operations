ALTER TABLE public.compliance_templates ADD COLUMN IF NOT EXISTS requires_final_consumer_signature boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.compliance_templates.requires_final_consumer_signature IS 'consumer_declaration only: set true by admin if the official Activity 48 form/rules require the consumer to sign again once final facts are known';

ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS signed_stage text NOT NULL DEFAULT 'post_install' CHECK (signed_stage IN ('post_install','quote_stage_conditional'));
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS conditional_snapshot jsonb;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS consumer_final_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS consumer_final_signature_name text;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS consumer_final_signed_at timestamptz;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS consumer_final_signed_by uuid;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS consumer_final_ip text;
ALTER TABLE public.customer_assignments ADD COLUMN IF NOT EXISTS consumer_final_snapshot_sha256 text;
COMMENT ON COLUMN public.customer_assignments.signed_stage IS 'quote_stage_conditional = consumer signed a binding conditional assignment at quote acceptance; NOT effective until the prescribed activity is undertaken and final facts/signatures complete';

CREATE OR REPLACE FUNCTION public.guard_assignment_conditional()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if old.signed_stage = 'quote_stage_conditional' and (new.signed_stage is distinct from old.signed_stage or new.conditional_snapshot is distinct from old.conditional_snapshot) then
    raise exception 'quote-stage conditional assignment snapshot is immutable';
  end if;
  if old.consumer_final_signed_at is not null and (new.consumer_final_signed_at is distinct from old.consumer_final_signed_at or new.consumer_final_signature_name is distinct from old.consumer_final_signature_name or new.consumer_final_snapshot_sha256 is distinct from old.consumer_final_snapshot_sha256) then
    raise exception 'final consumer confirmation is immutable';
  end if;
  return new;
end $$;
DROP TRIGGER IF EXISTS trg_guard_assignment_conditional ON public.customer_assignments;
CREATE TRIGGER trg_guard_assignment_conditional BEFORE UPDATE ON public.customer_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_conditional();