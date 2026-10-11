-- 0202_signed_webhook_nonces.sql  (STAGED — DO NOT APPLY without Jo's written approval).
--
-- PURPOSE: Phase 1 replay protection for signed Base44 webhooks (timestamped protocol).
--   App contract (src/routes/api/public/enquiry.ts) inserts, for each verified timestamped webhook:
--     { source: 'base44', purpose: 'enquiry', nonce: <header nonce>, signed_at: <header timestamp> }
--   A duplicate (source, purpose, nonce) MUST raise unique_violation (SQLSTATE 23505) so the route
--   rejects the replay. While this table is absent, enquiry.ts fails open on signature+timestamp trust
--   (schema-compat.core.isMissingDbObject) — exactly the current production fallback.
--
-- APPLICATION INSTRUCTIONS:
--   1) Apply AFTER 0149 (security-first; the two are otherwise independent).
--   2) Apply via the approved controlled process against a verified-backed database — never ad hoc.
--   3) Post-apply (read-only) check: a repeated timestamped webhook nonce is now rejected (401).
--
-- ROLLBACK: see 0202_signed_webhook_nonces.rollback.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.signed_webhook_nonces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL,
  purpose     text        NOT NULL,
  nonce       text        NOT NULL,
  signed_at   timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signed_webhook_nonces_unique UNIQUE (source, purpose, nonce)
);

-- Replay lookups and retention sweeps are by received_at.
CREATE INDEX IF NOT EXISTS signed_webhook_nonces_received_at_idx
  ON public.signed_webhook_nonces (received_at);

-- Lock the table down: only the service role (the server webhook handler) may touch it.
-- RLS enabled with NO policies => authenticated/anon get zero rows and cannot write; service_role bypasses RLS.
ALTER TABLE public.signed_webhook_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signed_webhook_nonces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.signed_webhook_nonces TO service_role;

COMMIT;
