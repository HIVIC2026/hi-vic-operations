-- Undo of 2026-11-01_in_house_saved_work.sql (written for go-live, G6 4 Nov 2026). Drops the three in-house booking
-- functions whole (commit_in_house_visit — whichever version is live, v1 or 2026-11-04 v2 —, in_house_visit_revision and
-- claim_in_house_saved_work). The portal's in-house booking then falls back to its inline TypeScript path
-- (in-house-inline-save.server). workflow_events rows already written (in_house_saved_work, visit_allocated, …) stay as history.
DROP FUNCTION IF EXISTS public.commit_in_house_visit(uuid,uuid,text,timestamptz,uuid,text,timestamptz,uuid,uuid,jsonb,jsonb,uuid);
DROP FUNCTION IF EXISTS public.claim_in_house_saved_work(uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.in_house_visit_revision(uuid);
