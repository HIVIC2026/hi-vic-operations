-- One-off (Jo 1 Nov 2026): links on jobs that were ALREADY cancelled before trg_owner_links_follow_cancel existed get
-- the same 'job_cancelled' revoke, so reopening them later restores the same link. Test jobs are skipped
-- (jobs.source = 'qa_test', or the owner's email or name contains "test"). Run AFTER owner-links-follow-cancel.sql.
-- Every link touched is recorded so the rollback restores exactly those. Safe to run twice.
-- Pending: proven on PGlite (tests/owner-links-cancelled-cleanup.pglite.test.ts); run live only with Jo's OK.
CREATE TABLE IF NOT EXISTS public.owner_links_cleanup_20261101(link_id uuid PRIMARY KEY);
REVOKE ALL ON public.owner_links_cleanup_20261101 FROM PUBLIC, anon, authenticated;

WITH t AS (
  SELECT l.id
    FROM public.customer_estimate_links l
    JOIN public.jobs j ON j.id = l.job_id
    LEFT JOIN public.owners o ON o.id = j.owner_id
   WHERE l.status = 'active' AND j.stage::text = 'cancelled' AND j.source <> 'qa_test'
     AND coalesce(o.email, '') NOT ILIKE '%test%' AND coalesce(o.full_name, '') NOT ILIKE '%test%'
), u AS (
  UPDATE public.customer_estimate_links l
     SET status = 'revoked', revoked_at = now(), revocation_reason = 'job_cancelled'
    FROM t WHERE l.id = t.id
  RETURNING l.id
)
INSERT INTO public.owner_links_cleanup_20261101(link_id) SELECT id FROM u ON CONFLICT DO NOTHING;
