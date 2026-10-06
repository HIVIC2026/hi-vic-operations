ALTER TABLE public.partner_rate_offers
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS link_reissued_at timestamptz;
UPDATE public.partner_rate_offers SET expires_at = created_at + interval '14 days' WHERE expires_at IS NULL;
ALTER TABLE public.partner_rate_offers ALTER COLUMN expires_at SET DEFAULT (now() + interval '14 days');
CREATE OR REPLACE FUNCTION public.guard_partner_rate_offer() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF NEW.items IS DISTINCT FROM OLD.items OR NEW.round <> OLD.round OR NEW.application_id <> OLD.application_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.gst_registered <> OLD.gst_registered THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF OLD.status <> 'sent' THEN RAISE EXCEPTION 'rate_offer:already_answered'; END IF;
  IF NEW.status <> 'sent' AND NEW.token_hash <> OLD.token_hash THEN RAISE EXCEPTION 'rate_offer:immutable'; END IF;
  IF NEW.status = 'accepted' AND (OLD.expires_at IS NULL OR OLD.expires_at < now()) THEN RAISE EXCEPTION 'rate_offer:expired'; END IF;
  RETURN NEW;
END $$;