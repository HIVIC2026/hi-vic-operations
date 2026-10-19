-- ===================================================================================================
-- ENQUIRY BACKLOG — STEP 4 of 4 — ABORT SWITCH. Only if a batch is wrong. Not needed in a normal run.
--
-- Removes only queue items this batch created that the worker has not started. An item the worker is
-- holding ('processing', short lease) is left to finish — interrupting a send is worse than letting the
-- sender's own guards decide. Sent email rows are never touched.
-- ===================================================================================================

with removed as (
  delete from public.post_intake_work w
  where w.reason = 'ENQUIRY_BACKLOG_MANUAL'
    and w.status in ('queued', 'retry')
  returning 1
)
select count(*) as cancelled_queue_items from removed;

-- Then run ENQ_02 3a: nothing should remain queued/retry for ENQUIRY_BACKLOG_MANUAL.
