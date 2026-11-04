-- Rollback for installer-worker-identity-dob.sql: drops the function only. Identity rows and audit history stay.
DROP FUNCTION IF EXISTS public.set_worker_identity_dob(uuid,date,uuid);
