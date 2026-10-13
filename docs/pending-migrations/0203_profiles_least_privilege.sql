-- 0203_profiles_least_privilege.sql  (STAGED — DO NOT APPLY without project-owner written approval; see README_DO_NOT_APPLY.md).
--
-- Project: Home Insulation Victoria · Phase 1 · Round 2 · Agent R4 (QA/Security)
-- Addresses: GAP-10 / D-6 "profiles least-privilege" (own-row access to sensitive columns).
--
-- NUMBERING (verified against the latest repository on 13 Oct 2026):
--   * drizzle/migrations/meta/_journal.json: 149 entries, idx 0..148, last tag 0148_job_soft_delete_claims.
--   * APPLIED_MANUALLY.md: 0149 (owner-quote RLS) and 0202 (webhook nonces) were applied OUT OF BAND to
--     production and deliberately NOT journalled. Staged pending files also already occupy 0149..0202.
--   * Therefore 0149 AND the whole 0150..0202 band are UNSAFE to reuse. The first clearly-free number
--     above every consumed value is 0203. This file is 0203. (Re-derive against the live ledger again
--     immediately before any apply; do not assume the never-committed 0150_profiles_least_privilege.sql
--     was ever applied — it never existed in Git history.)
--
-- GOAL (per committed contract in src/lib/my-profile.ts):
--   The signed-in browser (role `authenticated`) must NOT be able to SELECT other users' sensitive
--   profile columns (email, phone, business_id, licence_number, mitti_*). Each user reads ONLY their
--   own full row, via a SECURITY DEFINER RPC get_my_profile(). Office/Admin and server/service-role
--   access are preserved. Shared-job workflows continue to work because they run server-side under the
--   service role (RLS-exempt), not through the browser's authenticated role.
--
-- WHAT THIS CHANGES:
--   1) Creates get_my_profile() SECURITY DEFINER returning exactly the caller's own profiles row.
--   2) Replaces the broad "self_read" SELECT policy (id = auth.uid() OR shares_job_with(id)) with an
--      own-row-only policy "self_read_own" (id = auth.uid()) for the authenticated role.
--      - Admin keeps full access via the pre-existing generic "admin_all" policy (is_admin()).
--      - Service role bypasses RLS entirely, so all *.server.ts / *.functions.ts flows are unaffected.
--   3) Hardens get_my_profile execution grants (authenticated only; revoke from public/anon).
--
-- IDEMPOTENT: safe to re-run. ROLLBACK: see 0203_profiles_least_privilege.rollback.sql (restores self_read).
--
-- POST-APPLY (read-only) CHECKS:
--   * select get_my_profile() as the signed-in user returns ONLY that user's row.
--   * a direct `select email,phone from profiles where id <> auth.uid()` returns 0 rows for a browser user
--     who does not share admin rights (previously could return co-workers'/owners' rows on shared jobs).
--   * is_admin() users and the service role still read every row.

BEGIN;

-- 1) Own-row accessor. SECURITY DEFINER so it can read profiles regardless of the (now tighter) policy,
--    but it is written to ONLY ever return the caller's own row.
CREATE OR REPLACE FUNCTION public.get_my_profile()
  RETURNS public.profiles
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_profile() IS
  'D-6 least-privilege: returns ONLY the signed-in user''s own profile row (id = auth.uid()). '
  'SECURITY DEFINER so it is unaffected by the own-row-only self_read_own policy. '
  'The browser (authenticated) role must read its own sensitive columns through this function.';

-- 2) Tighten the SELECT policy to own-row only for the browser role.
--    Admin retains full access via the generic admin_all policy; service role bypasses RLS.
DROP POLICY IF EXISTS "self_read" ON public.profiles;
DROP POLICY IF EXISTS "self_read_own" ON public.profiles;
CREATE POLICY "self_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- 3) Execution grants: authenticated may call the RPC; revoke the default public/anon grant.
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

COMMIT;
