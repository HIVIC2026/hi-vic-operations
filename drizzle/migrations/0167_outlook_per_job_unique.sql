-- 0221 follow-up: the live database also carried a second global (provider, message) unique index under another
-- name. Outlook moves to per-job uniqueness (job_communications_job_provider_msg); every other provider keeps
-- global uniqueness through job_communications_provider_msg_other.
DROP INDEX IF EXISTS public.job_communications_provider_message_unique;