import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contactVisible, tradeJobAllowed, type AccessAssignment } from "../src/lib/trade-view.core";

const JOB = "job-1", BIZ = "biz-1", BOSS = "u-boss", STAFF = "u-staff";
const asg = (o: Partial<AccessAssignment> = {}): AccessAssignment => ({ job_id: JOB, business_id: BIZ, user_id: STAFF, active: true, ...o });
const ask = (o: Partial<Parameters<typeof tradeJobAllowed>[0]> = {}) =>
  tradeJobAllowed({ signedIn: true, userId: STAFF, businessId: BIZ, boss: false, jobId: JOB, assignments: [asg()], ...o });

describe("trade job access (step 9)", () => {
  test("assigned staff and their business owner are allowed", () => {
    expect(ask()).toBe(true);
    expect(ask({ userId: BOSS, boss: true })).toBe(true);
  });
  test("not assigned: no assignment on this job", () => expect(ask({ assignments: [asg({ job_id: "other-job" })] })).toBe(false));
  test("assignment ended", () => expect(ask({ assignments: [asg({ active: false })] })).toBe(false));
  test("a different business", () => {
    expect(ask({ businessId: "biz-2" })).toBe(false);
    expect(ask({ userId: BOSS, boss: true, businessId: "biz-2" })).toBe(false);
  });
  test("staff not assigned to that job (assignment names someone else)", () => expect(ask({ assignments: [asg({ user_id: "u-other" })] })).toBe(false));
  test("logged-out user", () => {
    expect(ask({ signedIn: false })).toBe(false);
    expect(ask({ userId: null })).toBe(false);
  });
});

describe("visit-current rule for owner contact details", () => {
  test("shown while arranging or a visit is still to do", () => {
    expect(contactVisible([])).toBe(true);
    expect(contactVisible([{ status: "confirmed" }])).toBe(true);
    expect(contactVisible([{ status: "completed" }, { status: "proposed" }])).toBe(true);
  });
  test("hidden once every visit for this business is done", () => {
    expect(contactVisible([{ status: "completed" }])).toBe(false);
    expect(contactVisible([{ status: "completed" }, { status: "cancelled" }])).toBe(false);
  });
});

describe("enforced on the server", () => {
  const tv = readFileSync("src/lib/trade-view.server.ts", "utf8");
  const js = readFileSync("src/lib/job-status.server.ts", "utf8");
  test("day page and job page use the one access check", () => {
    expect(tv).toMatch(/export async function tradeDay\(jobId: string, userId: string\) \{\n\s+const c = await requireTradeJob\(userId, jobId\);/);
    expect(js).toMatch(/async function ownJobCtx[\s\S]{0,120}requireTradeJob\(userId, jobId\)/);
  });
  test("day page hides owner contact details when the visit isn't current", () => {
    expect(tv).toContain("const showContact = contactVisible(mine ?? []);");
    expect(tv).toContain("phone: showContact ? ow?.phone ?? null : null");
  });
});

describe("step 7: a finished install still counts as the booked install", () => {
  for (const f of ["src/lib/esc.server.ts", "src/lib/consent.server.ts", "src/lib/official-forms.server.ts"])
    test(f, () => expect(readFileSync(f, "utf8")).toContain('.eq("kind", "installation").in("status", ["confirmed", "completed"])'));
});
