-- ===================================================================================================
-- T6 BACKLOG — STEP 4 of 4 — ABORT SWITCH (only if something is wrong). Never needed in a normal run.
--
-- Removes ONLY the queue items this batch created that the worker has not started yet.
-- * Already-sent email rows (customer_email_sends) are never touched.
-- * An item the worker is currently holding ('processing', short lease) is left to finish, because
--   interrupting it mid-send is worse than letting the sender's own guards decide.
-- ===================================================================================================

with removed as (
  delete from public.post_intake_work w
  where w.reason = 'T6_BACKLOG_MANUAL'
    and w.status in ('queued', 'retry')
  returning 1
)
select count(*) as cancelled_queue_items
from removed;

-- After this, re-run 3a: nothing should remain 'queued'/'retry' for reason = 'T6_BACKLOG_MANUAL'.
