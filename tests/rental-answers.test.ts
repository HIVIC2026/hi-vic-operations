// Task 19 (Jo 2 Nov 2026, answers 7 and 22): the owner tells us in the quick taps if the home is rented, the tenant's
// details and who lets us in. Pure rules + the readers other parts use (rentalAnswersFor / accessPersonFor / tenantFor)
// on an in-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  RENTAL_TAPS, RENTAL_TAPS_APPROVED, RENTAL_ANSWERS_CORRECTED_EVENT, buildRentalAnswers, nextRentalStep, rentalAnswersFromTaps, rentalAnswersProblems, rentalFieldProblem, type RentalAnswersInput,
} from "../src/lib/rental-answers.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "../src/lib/quick-taps.core";

const OWNER = { name: "Helen Owner", phone: "0400 000 000" };
const RENTED: RentalAnswersInput = { lives: "rented", tenantName: "Tina Lee", tenantMobile: "0400 111 222", tenantEmail: "Tina@Example.com", who: "property_manager", accessName: "Pat Ng", accessMobile: "0400 333 444" };

describe("rental answers (pure)", () => {
  test("Jo's question is verbatim; flag ships off", () => {
    expect(RENTAL_TAPS.livesThere).toBe("Do you live there or is it rented?");
    expect(RENTAL_TAPS.livesOptions).toEqual(["I live there", "It's rented"]);
    expect(RENTAL_TAPS_APPROVED).toBe(false);
  });
  test("\"I live there\" → nothing rented, no extra questions", () => {
    expect(rentalAnswersProblems({ lives: "live" })).toEqual([]);
    expect(nextRentalStep({ lives: "live" })).toBeNull();
    expect(buildRentalAnswers({ lives: "live" }, OWNER)).toEqual({ rented: false, tenant: null, access: null });
  });
  test("nothing answered → the first question; not complete", () => {
    expect(nextRentalStep({})).toBe("lives");
    expect(rentalAnswersProblems({}).length).toBe(1);
  });
  test("rented + property manager → tenant, access = the property manager in +614 form", () => {
    expect(rentalAnswersProblems(RENTED)).toEqual([]);
    expect(nextRentalStep(RENTED)).toBeNull();
    expect(buildRentalAnswers(RENTED, OWNER)).toEqual({
      rented: true,
      tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" },
      access: { who: "property_manager", name: "Pat Ng", mobile: "+61400333444" },
    });
  });
  test("\"The tenant\" reuses the tenant's details; \"me\" is the owner on file", () => {
    expect(buildRentalAnswers({ ...RENTED, who: "tenant", accessName: undefined, accessMobile: undefined }, OWNER).access).toEqual({ who: "tenant", name: "Tina Lee", mobile: "+61400111222" });
    expect(buildRentalAnswers({ ...RENTED, who: "owner" }, OWNER).access).toEqual({ who: "owner", name: "Helen Owner", mobile: "+61400000000" });
  });
  test("rented with no tenant email → the email problem; a landline is refused; a property manager needs name + mobile", () => {
    const noEmail = rentalAnswersProblems({ ...RENTED, tenantEmail: "" });
    expect(noEmail.length).toBe(1);
    expect(noEmail[0]).toMatch(/email/i);
    expect(nextRentalStep({ ...RENTED, tenantEmail: "" })).toBe("tenant_email");
    expect(rentalAnswersProblems({ ...RENTED, tenantMobile: "03 9123 4567" }).join(" ")).toMatch(/mobile/i);
    expect(nextRentalStep({ ...RENTED, tenantMobile: "03 9123 4567" })).toBe("tenant_mobile");
    expect(nextRentalStep({ ...RENTED, accessName: "" })).toBe("access_name");
    expect(nextRentalStep({ ...RENTED, accessMobile: "0412" })).toBe("access_mobile");
    expect(rentalAnswersProblems({ ...RENTED, who: undefined }).join(" ")).toMatch(/let us in/i);
    expect(() => buildRentalAnswers({ ...RENTED, tenantEmail: "" }, OWNER)).toThrow();
  });
  test("one typed field is checked on its own", () => {
    expect(rentalFieldProblem("tenant_email", "nope")).not.toBeNull();
    expect(rentalFieldProblem("tenant_email", "a@b.co")).toBeNull();
    expect(rentalFieldProblem("tenant_mobile", "0400 111 222")).toBeNull();
    expect(rentalFieldProblem("access_name", "  ")).not.toBeNull();
  });
  test("an old tap without the questions → null; stored answers read back", () => {
    expect(rentalAnswersFromTaps({ answers: { hatch: "yes" } })).toBeNull();
    expect(rentalAnswersFromTaps(null)).toBeNull();
    const stored = buildRentalAnswers(RENTED, OWNER);
    expect(rentalAnswersFromTaps({ answers: { rental: stored } })).toEqual(stored);
    expect(rentalAnswersFromTaps({ answers: { rental: { rented: true, tenant: null, access: null } } })).toBeNull();
  });
});

// ---- the readers ------------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { workflow_events: [], jobs: [] };
let readFails = false;
let clock = 0;
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = []; let desc = false; let lim = Infinity; let one = false;
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select() { return b; },
        eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return b; },
        maybeSingle() { lim = 1; one = true; return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(r[c])); return b; },
        order(_c: string, o?: { ascending?: boolean }) { desc = o?.ascending === false; return b; },
        limit(n: number) { lim = n; return b; },
        then(res, rej) {
          if (readFails) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
          const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).sort((a, b2) => String(a["created_at"]).localeCompare(String(b2["created_at"])) * (desc ? -1 : 1));
          return Promise.resolve({ data: one ? hit[0] ?? null : hit.slice(0, lim), error: null }).then(res, rej);
        },
      };
      return b;
    },
  },
}));
const logged: { jobId: string; actor: string | null; type: string; details: Row }[] = [];
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (jobId: string, actor: string | null, type: string, _s: string, details: Row) => {
    logged.push({ jobId, actor, type, details });
    tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: new Date(++clock).toISOString(), details });
  },
}));
const R = await import("../src/lib/rental-answers.server");

const ev = (jobId: string, type: string, rental: unknown) => tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: new Date(++clock).toISOString(), details: { answers: rental === undefined ? { hatch: "yes" } : { rental } } });
beforeEach(() => { tables["workflow_events"] = []; logged.length = 0; readFails = false; });

describe("rentalAnswersFor / accessPersonFor / tenantFor", () => {
  test("not asked → null everywhere", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, undefined);
    expect(await R.rentalAnswersFor("j1")).toBeNull();
    expect(await R.accessPersonFor("j1")).toBeNull();
    expect(await R.tenantFor("j1")).toBeNull();
    expect(await R.rentalAnswersFor("nobody")).toBeNull();
  });
  test("owner lives there → rented false; no access person, no tenant", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers({ lives: "live" }, OWNER));
    expect(await R.rentalAnswersFor("j1")).toEqual({ rented: false, tenant: null, access: null });
    expect(await R.accessPersonFor("j1")).toBeNull();
    expect(await R.tenantFor("j1")).toBeNull();
  });
  test("rented: tenant and the property manager come back", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(RENTED, OWNER));
    expect((await R.tenantFor("j1"))?.email).toBe("tina@example.com");
    expect(await R.accessPersonFor("j1")).toEqual({ who: "property_manager", name: "Pat Ng", mobile: "+61400333444" });
  });
  test("the owner lets us in → no access person (we call the owner anyway)", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers({ ...RENTED, who: "owner" }, OWNER));
    expect(await R.accessPersonFor("j1")).toBeNull();
    expect((await R.rentalAnswersFor("j1"))?.access?.who).toBe("owner");
  });
  test("an office correction wins (latest event)", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(RENTED, OWNER));
    ev("j1", RENTAL_ANSWERS_CORRECTED_EVENT, buildRentalAnswers({ ...RENTED, who: "tenant" }, OWNER));
    expect((await R.accessPersonFor("j1"))?.who).toBe("tenant");
  });
  test("a newer tap with no rental answers does not hide the earlier ones", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(RENTED, OWNER));
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, undefined);
    expect((await R.tenantFor("j1"))?.name).toBe("Tina Lee");
  });
  test("the office can correct: a new event, the old answers stay, latest wins; bad answers are refused", async () => {
    tables["jobs"] = [{ id: "j1", owners: { full_name: "Helen Owner", phone: "0400 000 000" } }];
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(RENTED, OWNER));
    await expect(R.correctRentalAnswers("j1", "office-1", { ...RENTED, tenantEmail: "" })).rejects.toThrow();
    await R.correctRentalAnswers("j1", "office-1", { ...RENTED, who: "owner" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ type: RENTAL_ANSWERS_CORRECTED_EVENT, actor: "office-1" });
    expect((await R.rentalAnswersFor("j1"))?.access?.who).toBe("owner");
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === QUICK_TAPS_ANSWERED_EVENT)).toHaveLength(1);
  });
  test("a read failure throws", async () => {
    readFails = true;
    await expect(R.rentalAnswersFor("j1")).rejects.toThrow();
  });
});
