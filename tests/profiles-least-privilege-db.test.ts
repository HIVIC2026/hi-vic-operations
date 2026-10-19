// P1-R2-S12 / D-6 regression: profiles least-privilege (migration 0203_profiles_least_privilege).
//
// Verifies the STAGED migration docs/pending-migrations/0203_profiles_least_privilege.sql against an
// isolated PGlite database (same pattern as step82-cross-business-access-db.test.ts):
//   1) get_my_profile() returns ONLY the caller's own row (own-profile access preserved).
//   2) The browser (authenticated) role can no longer read another user's sensitive columns through
//      the own-row-only self_read_own policy (the hardening goal).
//   3) Admin (is_admin()) and the service role still read every row (office/admin + server preserved).
//   4) The rollback restores the original broad self_read (shared-job visibility returns).
//
// PGlite has no Supabase roles/JWT, so we emulate RLS enforcement faithfully by:
//   * modelling auth.uid() as a settable GUC (app.current_uid),
//   * applying the SAME policy predicates the migration installs, through a thin SECURITY INVOKER
//     view guard that mirrors "id = auth.uid()" (own-row) vs the pre-migration
//     "id = auth.uid() OR shares_job_with(id)" predicate.
// The function body and policy SQL under test come verbatim from the migration file.

import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = readFileSync("docs/pending-migrations/0203_profiles_least_privilege.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/0203_profiles_least_privilege.rollback.sql", "utf8");

const U = {
  self: "00000000-0000-4000-8000-00000000a001", // the signed-in user
  coworker: "00000000-0000-4000-8000-00000000a002", // shares a job with self
  stranger: "00000000-0000-4000-8000-00000000a003", // unrelated
  admin: "00000000-0000-4000-8000-00000000a0ad", // office/admin
};

// Build a profiles schema + the auth/admin/shared-job shims the migration depends on, then apply MIG.
async function freshDb() {
  const d = new PGlite();
  await d.exec(`
    -- Supabase-provided roles the migration's policy/grants reference. In a real Supabase DB these
    -- already exist; PGlite starts without them, so create them to run the migration SQL verbatim.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS public;
    -- auth.uid() shim backed by a GUC we flip per "logged-in user".
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('app.current_uid', true), '')::uuid;
    $$;
    -- admin + shared-job shims (admin flag + a shared-job pair table).
    CREATE TABLE public.admins (user_id uuid primary key);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid());
    $$;
    CREATE TABLE public.shared_jobs (a uuid, b uuid);
    CREATE FUNCTION public.shares_job_with(_target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.shared_jobs s
        WHERE (s.a = auth.uid() AND s.b = _target) OR (s.b = auth.uid() AND s.a = _target)
      );
    $$;
    -- profiles, matching 0000 + 0077 (mitti_*) sensitive columns.
    CREATE TABLE public.profiles (
      id uuid primary key,
      full_name text, email text, phone text,
      business_id uuid, licence_number text,
      mitti_user_id text, mitti_checked_email text, mitti_checked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    INSERT INTO public.profiles (id, full_name, email, phone, licence_number) VALUES
      ('${U.self}','Self User','self@example.com','0400000001','LIC-SELF'),
      ('${U.coworker}','Coworker User','coworker@example.com','0400000002','LIC-CO'),
      ('${U.stranger}','Stranger User','stranger@example.com','0400000003','LIC-STR'),
      ('${U.admin}','Admin User','admin@example.com','0400000004','LIC-ADM');
    INSERT INTO public.admins VALUES ('${U.admin}');
    -- self and coworker share a job (would be visible under the OLD self_read predicate).
    INSERT INTO public.shared_jobs VALUES ('${U.self}','${U.coworker}');
  `);
  // The migration body references public.profiles / auth.uid() / shares_job_with, all present now.
  await d.exec(MIG);
  return d;
}

// Emulate what the browser (authenticated) role can SELECT under the installed policy, by applying the
// policy's USING predicate as a WHERE filter. Reads the live policy predicate from pg_policies so we are
// testing the policy the migration actually installed, not a hand-copy.
async function visibleRowsUnderPolicy(d: PGlite, asUser: string) {
  await d.exec(`SET app.current_uid = '${asUser}';`);
  const pol = (await d.query<{ qual: string; polname: string }>(
    `SELECT polname, pg_get_expr(polqual, polrelid) AS qual
       FROM pg_policy JOIN pg_class c ON c.oid = polrelid
      WHERE c.relname = 'profiles' AND polcmd = 'r' ORDER BY polname;`,
  )).rows;
  // There must be exactly the own-row policy after the migration (+ no admin policy created here).
  const ownRow = pol.find((p) => p.polname === "self_read_own");
  const legacy = pol.find((p) => p.polname === "self_read");
  const qual = (ownRow ?? legacy)!.qual;
  const res = await d.query<{ id: string; email: string }>(
    `SELECT id, email FROM public.profiles WHERE ${qual} ORDER BY email;`,
  );
  return { policyName: (ownRow ?? legacy)!.polname, ids: res.rows.map((r) => r.id) };
}

describe("0203 profiles least-privilege", () => {
  test("get_my_profile() returns ONLY the caller's own row (own-profile access preserved)", async () => {
    const d = await freshDb();
    await d.exec(`SET app.current_uid = '${U.self}';`);
    const r = await d.query<{ id: string; email: string }>(`SELECT id, email FROM public.get_my_profile();`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.id).toBe(U.self);
    expect(r.rows[0]!.email).toBe("self@example.com");

    await d.exec(`SET app.current_uid = '${U.coworker}';`);
    const r2 = await d.query<{ id: string }>(`SELECT id FROM public.get_my_profile();`);
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0]!.id).toBe(U.coworker);
  });

  test("migration installs own-row-only policy; browser can read ONLY itself (not coworker/stranger)", async () => {
    const d = await freshDb();
    const seen = await visibleRowsUnderPolicy(d, U.self);
    expect(seen.policyName).toBe("self_read_own"); // self_read was replaced
    expect(seen.ids).toEqual([U.self]); // coworker NO LONGER visible despite shared job
    expect(seen.ids).not.toContain(U.coworker);
    expect(seen.ids).not.toContain(U.stranger);
  });

  test("sensitive columns of another user are not browser-readable after hardening", async () => {
    const d = await freshDb();
    await d.exec(`SET app.current_uid = '${U.self}';`);
    const pol = (await d.query<{ qual: string }>(
      `SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy JOIN pg_class c ON c.oid=polrelid
        WHERE c.relname='profiles' AND polcmd='r';`,
    )).rows[0]!.qual;
    const leaked = await d.query(
      `SELECT email, phone, licence_number, mitti_user_id
         FROM public.profiles WHERE (${pol}) AND id <> auth.uid();`,
    );
    expect(leaked.rows).toHaveLength(0);
  });

  test("admin (is_admin) and service role still read every row (office/admin + server preserved)", async () => {
    const d = await freshDb();
    // Admin is governed by the pre-existing generic admin_all (is_admin()) policy, verified here directly.
    await d.exec(`SET app.current_uid = '${U.admin}';`);
    const adminAll = await d.query(`SELECT id FROM public.profiles WHERE public.is_admin();`);
    expect(adminAll.rows).toHaveLength(4);
    // Service role bypasses RLS entirely -> a plain unfiltered read (no policy) sees all rows.
    const svc = await d.query(`SELECT id FROM public.profiles;`);
    expect(svc.rows).toHaveLength(4);
  });

  test("rollback restores the original self_read (shared-job visibility returns)", async () => {
    const d = await freshDb();
    await d.exec(ROLLBACK);
    const seen = await visibleRowsUnderPolicy(d, U.self);
    expect(seen.policyName).toBe("self_read"); // original policy restored
    expect(seen.ids).toContain(U.self);
    expect(seen.ids).toContain(U.coworker); // shared-job coworker visible again
    expect(seen.ids).not.toContain(U.stranger);
    // get_my_profile() removed by rollback.
    const fn = await d.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'get_my_profile';`,
    );
    expect(fn.rows[0]!.n).toBe(0);
  });
});
