-- Rollback for 0202_signed_webhook_nonces.sql  (STAGED — DO NOT APPLY without Jo's written approval).
--
-- ROLLBACK INSTRUCTIONS:
--   Run this file to remove the replay-protection table. Safe: drops ONLY the append-only nonce log;
--   no business data is affected. After rollback the webhook degrades to signature+timestamp trust
--   via the existing schema-compat fail-open path (the same trust as the legacy protocol).
DROP TABLE IF EXISTS public.signed_webhook_nonces;
