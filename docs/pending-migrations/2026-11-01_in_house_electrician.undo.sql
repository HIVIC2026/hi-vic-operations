-- Undo of 2026-11-01_in_house_electrician.sql (written for go-live, G6 4 Nov 2026). Removes the Team-electrician
-- verification trigger, the office verify RPC, the allocation RPC and the three partner_workers columns it added.
-- Run 2026-11-03_allocate_team_electrician_v2_rollback.sql is NOT needed first: the function is dropped whole here.
-- Data written while live (licence_verified_at / rec_number / electrician assignments and their events) is lost with the
-- columns — only undo this if the in-house electrician screens are being switched off.
DROP FUNCTION IF EXISTS public.allocate_team_electrician(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.verify_team_electrician(uuid,text,text,date,uuid);
DROP TRIGGER IF EXISTS team_electrician_verification ON public.partner_workers;
DROP FUNCTION IF EXISTS public.guard_team_electrician_verification();
ALTER TABLE public.partner_workers
  DROP COLUMN IF EXISTS rec_number,
  DROP COLUMN IF EXISTS licence_verified_at,
  DROP COLUMN IF EXISTS licence_verified_by;
