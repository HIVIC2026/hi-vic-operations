import { afterAll, describe, expect, test } from "bun:test";
import { CALLERS, currentOverviewSql, inlineOverviewSql, jobOverviewAuthorityDb } from "./helpers/pglite-job-overview-authority";

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
  test("rollback restores the exact current view and each caller's values", async () => {
    await fixture.db.exec(currentOverviewSql);
    for (const [role, user] of Object.entries(CALLERS)) expect(await fixture.rows(user)).toEqual(before[role]);
    expect(await fixture.metadata()).toEqual(metadata);
  });
});