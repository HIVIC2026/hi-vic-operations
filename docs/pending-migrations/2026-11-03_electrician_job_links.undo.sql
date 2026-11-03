-- PENDING ONLY. Remove the electrician's no-login links. Every open link stops working (the page says the link isn't working).
BEGIN;

DROP TABLE public.electrician_job_links;

COMMIT;
