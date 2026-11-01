-- Undo owner-links-cancelled-cleanup.sql: the links it revoked go back to active, then the record table is dropped.
-- A link is skipped if its job already has another active link of the same purpose (one-active rule).
UPDATE public.customer_estimate_links l
   SET status = 'active', revoked_at = NULL, revocation_reason = NULL
  FROM public.owner_links_cleanup_20261101 c
 WHERE l.id = c.link_id AND l.status = 'revoked' AND l.revocation_reason = 'job_cancelled'
   AND NOT EXISTS (SELECT 1 FROM public.customer_estimate_links a
                    WHERE a.job_id = l.job_id AND a.purpose = l.purpose AND a.status = 'active');
DROP TABLE IF EXISTS public.owner_links_cleanup_20261101;
