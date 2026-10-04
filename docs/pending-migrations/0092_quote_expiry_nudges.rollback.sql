-- Rollback 0092 (step 5). Only safe while no quote has status 'expired'. Postgres cannot remove an enum value;
-- the 'expired' value stays defined but unused.
DROP INDEX IF EXISTS public.quotes_open_sent_idx;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS expired_at, DROP COLUMN IF EXISTS nudge_day10_at, DROP COLUMN IF EXISTS nudge_day3_at, DROP COLUMN IF EXISTS sent_at;
