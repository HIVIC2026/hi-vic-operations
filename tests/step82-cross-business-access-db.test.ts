// STEP 82 regression: cross-business field access is governed ONLY by assignment/membership
// data via 0115 public.job_assignment_role — never by a job's `source` (e.g. qa_test).
//
// Context: STEP81-D1 observed ffsadmin.uat opening another "business's" installation job
// (UAT-STEP81-A3-INSTALL, business 790…0101) via /field/<uuid>. STEP 82 investigation found
// the live cause was a FIXTURE inconsistency: ffsadmin.uat had been seeded a SECOND, active
// business_admin membership of the ASSIGNED business (790…0101). Under 0115 branch 3
// ("the business boss sees the business's assigned jobs") that correctly yields a role, so
// can_access_job returns true. No authorization code or RLS was at fault.
//
// These tests pin the intended guard so that:
//   * a business_admin of the ASSIGNED business gets the role (by design),
//   * a business_admin of an UNRELATED business gets NOTHING (no cross-business bypass),
//   * a plain member (not admin) of the assigned business gets NOTHING,
//   * the job's `source` value (incl. 'qa_test') NEVER changes the outcome.
// A future code change that introduced a source-based shortcut, or widened the admin branch
// to unrelated businesses, would fail here.

import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const UP = readFileSync("docs/pending-migrations/0115_trade_job_access.sql", "utf8");

// Mirrors the real STEP81 fixture shape.
const ID = {
  job: "81000000-0000-4000-8000-000000000203", // UAT-STEP81-A3-INSTALL (assigned to assignedBiz)
  assignedBiz: "79000000-0000-4000-8000-000000000101", // STEP79 FFS Insulation (TEST)
  otherBiz: "81000000-0000-4000-8000-000000000301", // STEP81 Other Installer Business (TEST)
  installerUser: "84b8893b-e1f8-45e4-8f86-d3155fbe9a39", // installer.uat — the job's assigned installer
  ffsAdmin: "bc6ce692-3360-48f3-9c8d-3b68fbdc7b6a", // ffsadmin.uat
  stranger: "00000000-0000-4000-8000-0000000000aa", // admin of an unrelated business only
  plainMember: "00000000-0000-4000-8000-0000000000bb", // a plain member of the assigned business, NOT the assigned user
};

// Build the schema + 0115 function, then seed a given set of business_members rows.
async function db(opts: {
  jobSource: string;
  // active business_admin memberships for ffsAdmin
  ffsAdminOf: string[];
  // active plain-member memberships for plainMember
  plainMemberOf: string[];
  // active business_admin memberships for stranger
  strangerAdminOf: string[];
}) {
  const d = new PGlite();
  await d.exec(`
    CREATE TYPE public.assignment_role AS ENUM ('electrician','installer','property_manager');
    CREATE TABLE public.jobs (id uuid primary key, source text);
    CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, business_id uuid, role public.assignment_role, active boolean default true);
    CREATE TABLE public.partner_workers (id uuid primary key, profile_id uuid, trade_role public.assignment_role, approval_status text, removed_at timestamptz);
    CREATE TABLE public.worker_job_links (job_id uuid, worker_id uuid, business_id uuid, revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean default true);
    INSERT INTO public.jobs VALUES ('${ID.job}', '${opts.jobSource}');
    -- the job has exactly one real assignment: the assigned business's installer
    INSERT INTO public.job_assignments VALUES ('${ID.job}','${ID.installerUser}','${ID.assignedBiz}','installer',true);
  `);
  for (const biz of opts.ffsAdminOf) {
    await d.exec(`INSERT INTO public.business_members VALUES ('${biz}','${ID.ffsAdmin}','business_admin',true);`);
  }
  for (const biz of opts.plainMemberOf) {
    await d.exec(`INSERT INTO public.business_members VALUES ('${biz}','${ID.plainMember}','member',true);`);
  }
  for (const biz of opts.strangerAdminOf) {
    await d.exec(`INSERT INTO public.business_members VALUES ('${biz}','${ID.stranger}','business_admin',true);`);
  }
  await d.exec(UP);
  return d;
}

const role = async (d: PGlite, job: string, user: string) =>
  (await d.query<{ r: string | null }>(`select public.job_assignment_role('${job}','${user}')::text as r`)).rows[0]?.r ?? null;

describe("STEP 82 — cross-business field access is data-driven, never source-driven", () => {
  test("REPRODUCTION: business_admin of the ASSIGNED business gets the role (the real STEP81-D1 cause, by design)", async () => {
    const d = await db({ jobSource: "qa_test", ffsAdminOf: [ID.assignedBiz], plainMemberOf: [], strangerAdminOf: [] });
    // This is exactly what the live DB showed: ffsadmin was seeded admin of 790…0101.
    expect(await role(d, ID.job, ID.ffsAdmin)).toBe("installer");
  });

  test("FIX EXPECTATION: business_admin of an UNRELATED business only → NO access (no cross-business bypass)", async () => {
    // Corrected fixture: ffsAdmin is admin of her OWN other business, NOT the assigned one.
    const d = await db({ jobSource: "qa_test", ffsAdminOf: [ID.otherBiz], plainMemberOf: [], strangerAdminOf: [] });
    expect(await role(d, ID.job, ID.ffsAdmin)).toBeNull();
  });

  test("stranger admin of a wholly unrelated business → NO access", async () => {
    const d = await db({ jobSource: "qa_test", ffsAdminOf: [], plainMemberOf: [], strangerAdminOf: [ID.otherBiz] });
    expect(await role(d, ID.job, ID.stranger)).toBeNull();
  });

  test("N1 control: plain member (not admin, not the assigned user) of the assigned business → NO access", async () => {
    const d = await db({ jobSource: "qa_test", ffsAdminOf: [], plainMemberOf: [ID.assignedBiz], strangerAdminOf: [] });
    // A plain 'member' of 790…0101 who is NOT the assigned installer: the admin branch must not fire.
    expect(await role(d, ID.job, ID.plainMember)).toBeNull();
  });

  test("the assigned installer themselves still has access (no regression to legitimate access)", async () => {
    const d = await db({ jobSource: "qa_test", ffsAdminOf: [], plainMemberOf: [], strangerAdminOf: [] });
    expect(await role(d, ID.job, ID.installerUser)).toBe("installer");
  });

  test("source value makes NO difference to any decision (qa_test hypothesis disproven)", async () => {
    for (const source of ["qa_test", "office"]) {
      // admin of assigned biz → access regardless of source
      const dAssigned = await db({ jobSource: source, ffsAdminOf: [ID.assignedBiz], plainMemberOf: [], strangerAdminOf: [] });
      expect(await role(dAssigned, ID.job, ID.ffsAdmin)).toBe("installer");
      // admin of unrelated biz → denied regardless of source
      const dUnrelated = await db({ jobSource: source, ffsAdminOf: [ID.otherBiz], plainMemberOf: [], strangerAdminOf: [] });
      expect(await role(dUnrelated, ID.job, ID.ffsAdmin)).toBeNull();
    }
  }, 20000);
});
