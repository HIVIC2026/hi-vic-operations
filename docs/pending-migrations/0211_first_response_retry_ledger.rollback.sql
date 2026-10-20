-- CANDIDATE ONLY. Disable/remove the new sweep caller before rollback; no jobs, sends or events are deleted.
DROP FUNCTION IF EXISTS public.finish_first_response_retry(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.start_first_response_retry(uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.claim_first_response_retries(timestamptz,integer);
DROP FUNCTION IF EXISTS public.first_response_retry_scope(timestamptz,timestamptz);
DROP TABLE IF EXISTS public.first_response_retries;
