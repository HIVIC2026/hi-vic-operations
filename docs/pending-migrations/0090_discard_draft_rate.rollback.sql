-- Rollback for 0090. Only valid while no row is 'discarded' (discarded rows must be kept as audit records).
DROP FUNCTION IF EXISTS public.discard_electrician_rate(uuid, uuid, text);
ALTER TABLE public.electrician_rates DROP CONSTRAINT IF EXISTS electrician_rates_status_check;
ALTER TABLE public.electrician_rates ADD CONSTRAINT electrician_rates_status_check CHECK (status IN ('draft','active','superseded','expired'));
ALTER TABLE public.electrician_rates DROP CONSTRAINT IF EXISTS electrician_rates_approved;
ALTER TABLE public.electrician_rates ADD CONSTRAINT electrician_rates_approved CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
CREATE OR REPLACE FUNCTION public.guard_electrician_rate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Approved electrician rates are permanent records'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','active') THEN RAISE EXCEPTION 'New electrician rates start as draft or active'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('superseded','expired') THEN RAISE EXCEPTION 'Superseded or expired electrician rates cannot be changed'; END IF;
  IF OLD.status = 'active' THEN
    IF NEW.status NOT IN ('active','superseded','expired') THEN RAISE EXCEPTION 'An active rate can only be superseded or expired'; END IF;
    IF (NEW.business_id, NEW.service_type, NEW.rate_inc_gst, NEW.effective_from, NEW.approved_by, NEW.approved_at, NEW.source_note)
       IS DISTINCT FROM (OLD.business_id, OLD.service_type, OLD.rate_inc_gst, OLD.effective_from, OLD.approved_by, OLD.approved_at, OLD.source_note)
    THEN RAISE EXCEPTION 'Active electrician rates cannot be edited; create a new rate instead'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
