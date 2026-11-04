// Task 19 (Jo 2 Nov 2026, answers 7 and 22): the owner tells us in the quick taps if the home is rented, the tenant's
// details and who lets us in. Pure rules + the readers other parts use (rentalAnswersFor / accessPersonFor / tenantFor)
// on an in-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  RENTAL_TAPS, RENTAL_TAPS_APPROVED, RENTAL_ANSWERS_CORRECTED_EVENT, buildRentalAnswers, nextRentalStep, rentalAnswersFromTaps, rentalAnswersProblems, rentalManagerProblems, rentalTenantProblems, rentalWhoChoices, type RentalAnswersInput,
} from "../src/lib/rental-answers.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "../src/lib/quick-taps.core";

const OWNER = { name: "Helen Owner", phone: "0400 000 000" };
// Jo 4 Nov 2026 (pack 2 batch 7): the four screens — tenant (email optional), property manager (name, agency, mobile, email), who we book with.
const RENTED: RentalAnswersInput = { lives: "rented", tenantName: "Tina Lee", tenantMobile: "0400 111 222", tenantEmail: "Tina@Example.com", manager: "yes", managerName: "Pat Ng", managerAgency: "Ng Realty", managerMobile: "0400 333 444", managerEmail: "Pat@Ng.Example", who: "property_manager" };

describe("rental answers (pure)", () => {
  test("Jo's screens are verbatim (4 Nov 2026 20:40); the flag ships ON (the screens replace the old access tap)", () => {
    expect(RENTAL_TAPS.livesThere).toBe("Do you live there, or is it rented out?");
    expect(RENTAL_TAPS.livesOptions).toEqual(["I live there", "It's rented out"]);
    expect(RENTAL_TAPS.tenantTitle).toBe("Who's the tenant?");
    expect(RENTAL_TAPS.tenantSub).toBe("We'll need to arrange access with them and let them know the install day. Nothing goes to them until you've accepted a quote.");
    expect(RENTAL_TAPS.managerTitle).toBe("Is there a property manager?");
    expect(RENTAL_TAPS.managerOptions).toEqual(["No, I deal with the tenant", "Yes"]);
    expect(RENTAL_TAPS.whoTitle).toBe("Who should we book the visits with?");
    expect(RENTAL_TAPS.whoOptions).toEqual(["Me", "The tenant", "The property manager"]);
    expect(RENTAL_TAPS_APPROVED).toBe(true);
  });
  test("\"I live there\" → nothing rented, no extra questions", () => {
    expect(rentalAnswersProblems({ lives: "live" })).toEqual([]);
    expect(nextRentalStep({ lives: "live" })).toBeNull();
    expect(buildRentalAnswers({ lives: "live" }, OWNER)).toEqual({ rented: false, tenant: null, manager: null, access: null });
  });
  test("nothing answered → the first screen; not complete", () => {
    expect(nextRentalStep({})).toBe("lives");
    expect(rentalAnswersProblems({}).length).toBe(1);
  });
  test("rented + property manager → tenant, manager and access = the property manager in +614 form", () => {
    expect(rentalAnswersProblems(RENTED)).toEqual([]);
    expect(nextRentalStep(RENTED)).toBeNull();
    expect(buildRentalAnswers(RENTED, OWNER)).toEqual({
      rented: true,
      tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" },
      manager: { name: "Pat Ng", agency: "Ng Realty", mobile: "+61400333444", email: "pat@ng.example" },
      access: { who: "property_manager", name: "Pat Ng", mobile: "+61400333444" },
    });
  });
  test("\"The tenant\" reuses the tenant's details; \"me\" is the owner on file; no manager → manager null and 'The property manager' is not offered", () => {
    expect(buildRentalAnswers({ ...RENTED, who: "tenant" }, OWNER).access).toEqual({ who: "tenant", name: "Tina Lee", mobile: "+61400111222" });
    expect(buildRentalAnswers({ ...RENTED, who: "owner" }, OWNER).access).toEqual({ who: "owner", name: "Helen Owner", mobile: "+61400000000" });
    const noManager = buildRentalAnswers({ ...RENTED, manager: "no", who: "tenant" }, OWNER);
    expect(noManager.manager).toBeNull();
    expect(rentalWhoChoices({ ...RENTED, manager: "no" }).map((c) => c.value)).toEqual(["owner", "tenant"]);
    expect(rentalWhoChoices(RENTED).map((c) => c.label)).toEqual(["Me", "The tenant", "The property manager"]);
    expect(rentalAnswersProblems({ ...RENTED, manager: "no", who: "property_manager" }).join(" ")).toMatch(/no property manager/i);
  });
  test("the tenant's email is optional; a typed one must look right; a landline is refused; a manager needs name + mobile (agency and email optional)", () => {
    expect(rentalAnswersProblems({ ...RENTED, tenantEmail: "" })).toEqual([]);
    expect(buildRentalAnswers({ ...RENTED, tenantEmail: "" }, OWNER).tenant?.email).toBe("");
    expect(rentalTenantProblems({ ...RENTED, tenantEmail: "nope" }).join(" ")).toMatch(/email/i);
    expect(nextRentalStep({ ...RENTED, tenantEmail: "nope" })).toBe("tenant");
    expect(rentalAnswersProblems({ ...RENTED, tenantMobile: "03 9123 4567" }).join(" ")).toMatch(/mobile/i);
    expect(nextRentalStep({ ...RENTED, tenantMobile: "03 9123 4567" })).toBe("tenant");
    expect(nextRentalStep({ ...RENTED, manager: undefined })).toBe("manager");
    expect(nextRentalStep({ ...RENTED, managerName: "" })).toBe("manager");
    expect(nextRentalStep({ ...RENTED, managerMobile: "0412" })).toBe("manager");
    expect(rentalManagerProblems({ ...RENTED, managerAgency: "", managerEmail: "" })).toEqual([]);
    expect(rentalManagerProblems({ ...RENTED, managerEmail: "bad" }).join(" ")).toMatch(/email/i);
    expect(nextRentalStep({ ...RENTED, who: undefined })).toBe("who");
    expect(rentalAnswersProblems({ ...RENTED, who: undefined }).join(" ")).toMatch(/book the visits/i);
    expect(() => buildRentalAnswers({ ...RENTED, tenantMobile: "" }, OWNER)).toThrow();
  });
  test("an old tap without the questions → null; stored answers read back (old answers without a manager too)", () => {
    expect(rentalAnswersFromTaps({ answers: { hatch: "yes" } })).toBeNull();
    expect(rentalAnswersFromTaps(null)).toBeNull();
    const stored = buildRentalAnswers(RENTED, OWNER);
    expect(rentalAnswersFromTaps({ answers: { rental: stored } })).toEqual(stored);
    expect(rentalAnswersFromTaps({ answers: { rental: { rented: true, tenant: null, access: null } } })).toBeNull();
    const old = { rented: true, tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" }, access: { who: "tenant", name: "Tina Lee", mobile: "+61400111222" } };
    expect(rentalAnswersFromTaps({ answers: { rental: old } })).toEqual({ ...old, manager: null });
    expect(rentalAnswersFromTaps({ answers: { rental: { ...old, tenant: { ...old.tenant, email: "" } } } })?.tenant?.email).toBe("");
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
    expect(await R.rentalAnswersFor("j1")).toEqual({ rented: false, tenant: null, manager: null, access: null });
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
    await expect(R.correctRentalAnswers("j1", "office-1", { ...RENTED, tenantMobile: "" })).rejects.toThrow();
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
