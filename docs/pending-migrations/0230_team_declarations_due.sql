-- 0230 (Jo 29 Oct 2026): people added on the Team page must sign the worker declarations by link before any job.
-- Adds partner_workers.declarations_due. Existing people read false, so nobody already on a team is affected.
-- Needs 0229 first. Safe to run twice. Not applied live until Jo approves.
ALTER TABLE public.partner_workers ADD COLUMN IF NOT EXISTS declarations_due boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.partner_workers.declarations_due IS 'Jo 29 Oct 2026: true = added on Team, must sign the worker declarations by link before any job.';
