-- 0146: 24-hour single-use partner login links (Jo, 7 Oct). The built-in reset token lasts 1 hour, so the email carries
-- our own token; opening it mints a fresh one-time set-password token on the spot. Server-only (no client policies).
CREATE TABLE IF NOT EXISTS public.partner_login_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  application_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  used_at timestamptz
);
GRANT ALL ON public.partner_login_links TO service_role;
ALTER TABLE public.partner_login_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS partner_login_links_email_idx ON public.partner_login_links (email);
-- Single use, enforced in the database: claim succeeds once, only before expiry.
CREATE OR REPLACE FUNCTION public.claim_partner_login_link(_token_hash text)
RETURNS TABLE (email text, outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.partner_login_links;
BEGIN
  SELECT * INTO r FROM public.partner_login_links l WHERE l.token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::text, 'invalid'; RETURN; END IF;
  IF r.used_at IS NOT NULL THEN RETURN QUERY SELECT NULL::text, 'used'; RETURN; END IF;
  IF r.expires_at <= now() THEN RETURN QUERY SELECT NULL::text, 'expired'; RETURN; END IF;
  UPDATE public.partner_login_links SET used_at = now() WHERE id = r.id;
  RETURN QUERY SELECT r.email, 'ok';
END $$;
REVOKE ALL ON FUNCTION public.claim_partner_login_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_partner_login_link(text) TO service_role;
