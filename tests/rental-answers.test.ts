// Task 19 (Jo 2 Nov 2026, answers 7 and 22; Jo 4 Nov 2026 21:40 two screens): the owner tells us in the quick taps who we
// arrange access with (me / my tenant / my property manager) and their details. Pure rules + the readers other parts use (rentalAnswersFor / accessPersonFor / tenantFor)
// on an in-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  RENTAL_TAPS, RENTAL_TAPS_APPROVED, RENTAL_ANSWERS_CORRECTED_EVENT, buildRentalAnswers, nextRentalStep, noticePersonOf, rentalAnswersFromTaps, rentalAnswersProblems, rentalDetailsProblems, rentalWhoChoices, type RentalAnswersInput,
} from "../src/lib/rental-answers.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "../src/lib/quick-taps.core";

const OWNER = { name: "Helen Owner", phone: "0400 000 000" };
// Jo 4 Nov 2026 21:40 (pack 2): two screens — who we arrange access with, then their details (email optional).
const TENANT: RentalAnswersInput = { who: "tenant", name: "Tina Lee", mobile: "0400 111 222", email: "Tina@Example.com" };
const MANAGER: RentalAnswersInput = { who: "property_manager", name: "Pat Ng", mobile: "0400 333 444", email: "Pat@Ng.Example" };
const RENTED = MANAGER;

describe("rental answers (pure)", () => {
  test("Jo's screens are verbatim (4 Nov 2026 21:40); the flag ships ON (the screens replace the old access tap)", () => {
    expect(RENTAL_TAPS.whoTitle).toBe("Who should we arrange access with?");
    expect(RENTAL_TAPS.whoOptions).toEqual(["Me", "My tenant", "My property manager"]);
    expect(RENTAL_TAPS.detailsTitle).toBe("Their details");
    expect([RENTAL_TAPS.name, RENTAL_TAPS.mobile, RENTAL_TAPS.email]).toEqual(["Name", "Mobile", "Email (optional)"]);
    expect(RENTAL_TAPS_APPROVED).toBe(true);
    expect("livesThere" in RENTAL_TAPS).toBe(false); // the "I live there / rented out" question is gone
    expect(rentalWhoChoices().map((c) => c.label)).toEqual(["Me", "My tenant", "My property manager"]);
  });
  test("\"Me\" → nothing else to arrange, no extra screen", () => {
    expect(rentalAnswersProblems({ who: "owner" })).toEqual([]);
    expect(nextRentalStep({ who: "owner" })).toBeNull();
    expect(buildRentalAnswers({ who: "owner" }, OWNER)).toEqual({ rented: false, tenant: null, manager: null, access: null });
  });
  test("nothing answered → the first screen; not complete", () => {
    expect(nextRentalStep({})).toBe("who");
    expect(rentalAnswersProblems({}).length).toBe(1);
  });
  test("my tenant → the details screen, then the tenant is the access person (+614 form, email lower-cased)", () => {
    expect(nextRentalStep({ who: "tenant" })).toBe("details");
    expect(rentalAnswersProblems(TENANT)).toEqual([]);
    expect(nextRentalStep(TENANT)).toBeNull();
    expect(buildRentalAnswers(TENANT, OWNER)).toEqual({
      rented: true,
      tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" },
      manager: null,
      access: { who: "tenant", name: "Tina Lee", mobile: "+61400111222" },
    });
  });
  test("my property manager → the details screen, then the manager is the access person and the notice person", () => {
    expect(nextRentalStep({ who: "property_manager" })).toBe("details");
    const built = buildRentalAnswers(MANAGER, OWNER);
    expect(built).toEqual({
      rented: true,
      tenant: null,
      manager: { name: "Pat Ng", agency: "", mobile: "+61400333444", email: "pat@ng.example" },
      access: { who: "property_manager", name: "Pat Ng", mobile: "+61400333444" },
    });
    expect(noticePersonOf(built)).toEqual({ name: "Pat Ng", mobile: "+61400333444", email: "pat@ng.example" });
    expect(noticePersonOf(buildRentalAnswers(TENANT, OWNER))).toEqual({ name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" });
    expect(noticePersonOf(buildRentalAnswers({ who: "owner" }, OWNER))).toBeNull();
    expect(noticePersonOf(null)).toBeNull();
  });
  test("the email is optional; a typed one must look right; a landline is refused; name + mobile are needed", () => {
    expect(rentalAnswersProblems({ ...TENANT, email: "" })).toEqual([]);
    expect(buildRentalAnswers({ ...TENANT, email: "" }, OWNER).tenant?.email).toBe("");
    expect(rentalDetailsProblems({ ...TENANT, email: "nope" }).join(" ")).toMatch(/email/i);
    expect(nextRentalStep({ ...TENANT, email: "nope" })).toBe("details");
    expect(rentalAnswersProblems({ ...TENANT, mobile: "03 9123 4567" }).join(" ")).toMatch(/mobile/i);
    expect(nextRentalStep({ ...MANAGER, mobile: "0412" })).toBe("details");
    expect(nextRentalStep({ ...MANAGER, name: "" })).toBe("details");
    expect(rentalAnswersProblems({ ...MANAGER, name: "", mobile: "" })).toHaveLength(2);
    expect(() => buildRentalAnswers({ ...TENANT, mobile: "" }, OWNER)).toThrow();
  });
  test("an old tap without the questions → null; stored answers read back (old four-screen answers with a tenant and a manager too)", () => {
    expect(rentalAnswersFromTaps({ answers: { hatch: "yes" } })).toBeNull();
    expect(rentalAnswersFromTaps(null)).toBeNull();
    for (const stored of [buildRentalAnswers(TENANT, OWNER), buildRentalAnswers(MANAGER, OWNER), buildRentalAnswers({ who: "owner" }, OWNER)]) {
      expect(rentalAnswersFromTaps({ answers: { rental: stored } })).toEqual(stored);
    }
    expect(rentalAnswersFromTaps({ answers: { rental: { rented: true, tenant: null, access: null } } })).toBeNull();
    const old = { rented: true, tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" }, manager: { name: "Pat Ng", agency: "Ng Realty", mobile: "+61400333444", email: "pat@ng.example" }, access: { who: "property_manager", name: "Pat Ng", mobile: "+61400333444" } };
    expect(rentalAnswersFromTaps({ answers: { rental: old } })).toEqual(old);
    expect(noticePersonOf(rentalAnswersFromTaps({ answers: { rental: old } }))?.name).toBe("Pat Ng"); // the person picked
    const older = { rented: true, tenant: old.tenant, access: { who: "tenant", name: "Tina Lee", mobile: "+61400111222" } };
    expect(rentalAnswersFromTaps({ answers: { rental: older } })).toEqual({ ...older, manager: null });
    expect(rentalAnswersFromTaps({ answers: { rental: { ...older, tenant: { ...older.tenant, email: "" } } } })?.tenant?.email).toBe("");
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
  test("\"Me\" → rented false; no access person, no tenant", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers({ who: "owner" }, OWNER));
    expect(await R.rentalAnswersFor("j1")).toEqual({ rented: false, tenant: null, manager: null, access: null });
    expect(await R.accessPersonFor("j1")).toBeNull();
    expect(await R.tenantFor("j1")).toBeNull();
  });
  test("my tenant: the tenant comes back as the access person; my property manager: the manager does", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(TENANT, OWNER));
    expect((await R.tenantFor("j1"))?.email).toBe("tina@example.com");
    expect(await R.accessPersonFor("j1")).toEqual({ who: "tenant", name: "Tina Lee", mobile: "+61400111222" });
    ev("j2", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(MANAGER, OWNER));
    expect(await R.tenantFor("j2")).toBeNull();
    expect(await R.accessPersonFor("j2")).toEqual({ who: "property_manager", name: "Pat Ng", mobile: "+61400333444" });
  });
  test("an office correction wins (latest event)", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(MANAGER, OWNER));
    ev("j1", RENTAL_ANSWERS_CORRECTED_EVENT, buildRentalAnswers(TENANT, OWNER));
    expect((await R.accessPersonFor("j1"))?.who).toBe("tenant");
  });
  test("a newer tap with no rental answers does not hide the earlier ones", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(TENANT, OWNER));
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, undefined);
    expect((await R.tenantFor("j1"))?.name).toBe("Tina Lee");
  });
  test("the office can correct: a new event, the old answers stay, latest wins; bad answers are refused", async () => {
    ev("j1", QUICK_TAPS_ANSWERED_EVENT, buildRentalAnswers(RENTED, OWNER));
    await expect(R.correctRentalAnswers("j1", "office-1", { ...RENTED, mobile: "" })).rejects.toThrow();
    await R.correctRentalAnswers("j1", "office-1", { who: "owner" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ type: RENTAL_ANSWERS_CORRECTED_EVENT, actor: "office-1" });
    expect((await R.rentalAnswersFor("j1"))?.rented).toBe(false);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === QUICK_TAPS_ANSWERED_EVENT)).toHaveLength(1);
  });
  test("a read failure throws", async () => {
    readFails = true;
    await expect(R.rentalAnswersFor("j1")).rejects.toThrow();
  });
});
