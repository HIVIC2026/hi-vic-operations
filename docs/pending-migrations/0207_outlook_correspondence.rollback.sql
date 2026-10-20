-- Rollback 0207 (keeps job_communications and its pre-existing unique index untouched).
DROP TABLE IF EXISTS public.correspondence_reviews;
DROP TABLE IF EXISTS public.outlook_sync_state;
