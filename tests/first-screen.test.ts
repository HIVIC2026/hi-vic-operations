// Portal speed step 2, Task 6: sign-in opens the first screen in one go. `firstScreenAfterSignIn` returns the same two
// facts /portal read from the browser (roles, business linked) — so the unchanged rule `portalDestination` sends everyone
// where it did — and the first screen's own answer, in at most 3 rounds. In-memory database behind the round counter;
// the screen readers are stubs that each make one read (the real ones are pinned by their own round tests).
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { ROUND_LIMIT, roundCounter } from "./helpers/round-counter";

const tables: Tables = { user_roles: [], profiles: [], businesses: [] };
const rc = roundCounter(memoryPostgrest(tables));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: rc.client }));
const { firstScreenAfterSignIn } = await import("../src/lib/first-screen.server");
const { portalDestination } = await import("../src/lib/set-password-link.core");

const U = "00000000-0000-4000-8000-0000000000a1";
const seed = (roles: string[], businessId: string | null = null) => {
  tables["user_roles"] = roles.map((role) => ({ user_id: U, role }));
  tables["profiles"] = [{ id: U, business_id: businessId }];
};
const oneRead = async <T,>(v: T) => { await rc.client.from("businesses").select("id"); return v; };
const HOME = { myWork: { rows: [{ jobId: "j1" }] }, when: new Date("2026-11-05T00:00:00Z") };
const NEEDS = { groups: [], total: 0, computedAt: "2026-11-05T00:00:00Z", refreshing: false };
const deps = (o: Partial<Parameters<typeof firstScreenAfterSignIn>[1]> = {}) => ({
  tradeHome: () => oneRead(HOME),
  officeIdentity: () => oneRead("admin" as const),
  needsMe: () => oneRead(NEEDS),
  ...o,
});
const run = (d = deps()) => rc.countRounds(() => firstScreenAfterSignIn(U, d));

describe("first screen after sign-in", () => {
  test("installer → /field with My work's own answer (as getTradeHome gives it), in at most 3 rounds", async () => {
    seed(["installer"]);
    const r = await run();
    expect(portalDestination(r.result)).toBe("/field");
    expect(r.result.home).toEqual({ value: JSON.parse(JSON.stringify(HOME)) });
    expect(r.result.needs).toBeUndefined();
    expect(r.rounds).toBeLessThanOrEqual(ROUND_LIMIT);
  });
  test("office admin → /admin/needs-me with Needs me's saved copy, in at most 3 rounds", async () => {
    seed(["admin"]);
    const r = await run();
    expect(portalDestination(r.result)).toBe("/admin/needs-me");
    expect(r.result.needs).toEqual({ value: NEEDS });
    expect(r.result.home).toBeUndefined();
    expect(r.rounds).toBeLessThanOrEqual(ROUND_LIMIT);
  });
  test("the TEST office lands on Needs me as today but gets no live copy handed over", async () => {
    seed(["qa_office"]);
    const r = await run(deps({ officeIdentity: () => oneRead("qa_office" as const) }));
    expect(portalDestination(r.result)).toBe("/admin/needs-me");
    expect(r.result.needs).toBeUndefined();
  });
  test("no role and no business → today's no-access page, nothing handed over", async () => {
    seed([]);
    const r = await run(deps({ tradeHome: () => Promise.reject(new Error("Your sign-in isn't linked to an approved business yet.")), officeIdentity: () => Promise.reject(new Error("Admin only.")) }));
    expect(portalDestination(r.result)).toBe("no-access");
    expect(r.result.home).toBeUndefined();
    expect(r.result.needs).toBeUndefined();
  });
  test("a business linked to the profile without a trade role → /field, as today; not linked → My work's own null", async () => {
    seed([], "biz-1");
    const r = await run(deps({ tradeHome: () => Promise.reject(new Error("Your sign-in isn't linked to an approved business yet.")) }));
    expect(portalDestination(r.result)).toBe("/field");
    expect(r.result.home).toEqual({ value: null });
  });
  test("a suspended / refused partner: the screen's error is not handed over — My work asks itself and shows its own message", async () => {
    seed(["installer"]);
    const r = await run(deps({ tradeHome: () => Promise.reject(new Error("This business is paused.")) }));
    expect(portalDestination(r.result)).toBe("/field");
    expect(r.result.home).toBeUndefined();
  });
  test("an admin who is also a trade → today's chooser, nothing handed over; owners → /owner", async () => {
    seed(["admin", "installer"]);
    expect(portalDestination((await run()).result)).toBe("choose");
    seed(["owner"]);
    const r = await run();
    expect(portalDestination(r.result)).toBe("/owner");
    expect(r.result.home).toBeUndefined();
    expect(r.result.needs).toBeUndefined();
  });
  test("the portal hands the answers to the screens' own cache entries and keeps its fallback", () => {
    const src = readFileSync("src/routes/portal.tsx", "utf8");
    expect(src).toContain('qc.setQueryData(["trade-home"], first.home.value)');
    expect(src).toContain('qc.setQueryData(["needs-me-v2", false], first.needs.value)');
    expect(src).toContain("const to = portalDestination(data);");
    expect(src).toContain('readMyProfile(supabase as unknown as ProfileClient, u.user.id)');
    expect(readFileSync("src/routes/_authenticated/admin.needs-me.tsx", "utf8")).toContain('queryKey: ["needs-me-v2", includeTest]');
  });
});

test("speed: an installer's sign-in never starts the office check (it would take request slots from the home's reads)", async () => {
  seed(["installer"]);
  let office = 0;
  const r = await run(deps({ officeIdentity: () => { office++; return oneRead("admin" as const); } }));
  expect(portalDestination(r.result)).toBe("/field");
  expect(office).toBe(0);
  seed(["admin"]);
  await run(deps({ officeIdentity: () => { office++; return oneRead("admin" as const); } }));
  expect(office).toBe(1);
});
