CREATE OR REPLACE FUNCTION public.guard_partner_rate_offer() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF NEW.items IS DISTINCT FROM OLD.items OR NEW.round <> OLD.round OR NEW.application_id <> OLD.application_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.token_hash <> OLD.token_hash
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.gst_registered <> OLD.gst_registered THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF OLD.status <> 'sent' THEN RAISE EXCEPTION 'rate_offer:already_answered'; END IF;
  RETURN NEW;
END $$;
ALTER TABLE public.partner_rate_offers DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS code_hash, DROP COLUMN IF EXISTS code_expires_at, DROP COLUMN IF EXISTS code_attempts, DROP COLUMN IF EXISTS link_reissued_at;
