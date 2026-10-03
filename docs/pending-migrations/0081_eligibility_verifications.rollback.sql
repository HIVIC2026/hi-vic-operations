-- Rollback for 0081. Audit entries already written to workflow_events are kept as history.
DROP FUNCTION IF EXISTS public.record_eligibility_verification(uuid, text, integer, text, boolean, jsonb, jsonb, jsonb, text, text, text);
DROP TABLE IF EXISTS public.eligibility_verifications;
