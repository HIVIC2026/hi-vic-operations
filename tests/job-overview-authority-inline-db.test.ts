import { afterAll, describe, expect, test } from "bun:test";
import { CALLERS, inlineOverviewSql, rollbackOverviewSql, jobOverviewAuthorityDb } from "./helpers/pglite-job-overview-authority";

const fixture = await jobOverviewAuthorityDb();
const before = Object.fromEntries(await Promise.all(Object.entries(CALLERS).map(async ([role, id]) => [role, await fixture.rows(id)])));
const metadata = await fixture.metadata();
await fixture.db.exec(inlineOverviewSql);
afterAll(() => fixture.db.close());

describe("job overview inline authority — actual authority RLS, PGlite only", () => {
  for (const [role, user] of Object.entries(CALLERS)) {
    test(`${role}: all authority values match the existing view`, async () => {
      expect(await fixture.rows(user)).toEqual(before[role]);
    });
  }
  test("column order/types, owner, security_invoker and grants stay unchanged", async () => {
    expect(await fixture.metadata()).toEqual(metadata);
  });
  test("TEST office sees jobs only via qa_office_job_allowed, with no authority access", async () => {
    await fixture.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [CALLERS.qa_office]);
      const result = await tx.query<{ allowed: boolean; ordinary_access: boolean; admin: boolean }>(
        "SELECT qa_office_job_allowed(id) AS allowed, can_access_job(id) AS ordinary_access, is_admin() AS admin FROM jobs",
      );
      expect(result.rows).toHaveLength(6);
      for (const row of result.rows) expect(row).toEqual({ allowed: true, ordinary_access: false, admin: false });
      expect((await tx.query("SELECT * FROM job_authority_latest()")).rows).toEqual([]);
    });
    expect(before.qa_office).toHaveLength(6);
    for (const row of before.qa_office) {
      expect(row.authority_status).toBeNull();
      expect(row.authority_expires_at).toBeNull();
    }
  });
  test("new definer function grants exclude public and anon", async () => {
    const result = await fixture.db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(`
      SELECT has_function_privilege('anon','public.job_authority_latest()','EXECUTE') AS anon,
        has_function_privilege('authenticated','public.job_authority_latest()','EXECUTE') AS authenticated,
        has_function_privilege('service_role','public.job_authority_latest()','EXECUTE') AS service_role
    `);
    expect(result.rows).toEqual([{ anon: false, authenticated: true, service_role: true }]);
  });
  test("rollback restores the exact current view and each caller's values", async () => {
    await fixture.db.exec(rollbackOverviewSql);
    for (const [role, user] of Object.entries(CALLERS)) expect(await fixture.rows(user)).toEqual(before[role]);
    expect(await fixture.metadata()).toEqual(metadata);
    expect((await fixture.db.query("SELECT to_regprocedure('public.job_authority_latest()') AS fn")).rows).toEqual([{ fn: null }]);
  });
});