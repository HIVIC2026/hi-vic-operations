-- Undo for add-installer-job-atomic.sql (A6): drops only the one-transaction Add a job function. Jobs, owners, consents
-- and events it already saved stay. Without it the server falls back to its step-by-step save (isMissingDbObject).
drop function if exists public.add_installer_job(jsonb);
