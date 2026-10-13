-- Rollback for 0203_profiles_least_privilege.sql  (STAGED — DO NOT APPLY without project-owner written approval).
--
-- Restores the exact pre-0203 state:
--   * profiles SELECT policy -> restored to the original 0000 "self_read"
--     (id = auth.uid() OR public.shares_job_with(id)).
--   * get_my_profile() -> removed (introduced by 0203).
--   * self_read_own policy -> removed (introduced by 0203).
-- Safe: touches only a policy and a function; no business data is modified.
-- After rollback, the browser (authenticated) role again reads shared-job co-workers'/owners' profile
-- rows via self_read, and get_my_profile() no longer exists.

BEGIN;

-- 1) Remove the 0203 own-row policy and restore the original broad self_read.
DROP POLICY IF EXISTS "self_read_own" ON public.profiles;
DROP POLICY IF EXISTS "self_read" ON public.profiles;
CREATE POLICY "self_read" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_job_with(id));

-- 2) Drop the RPC introduced by 0203.
DROP FUNCTION IF EXISTS public.get_my_profile();

COMMIT;
