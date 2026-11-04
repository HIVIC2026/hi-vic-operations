// Fix wave C2 (installer screens, 3 Nov 2026): an Office person (business_members.member_role = 'office') works the portal
// for the business — READS and BOOKINGS like the boss (every job assigned to the business, the booking Team), while Money
// stays behind "Can see Money", and Team / business settings stay boss-only. REAL server modules against an in-memory
// database (tests/helpers/memory-postgrest.ts). Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { seesBusinessJobs } from "../src/lib/trade-access-role.core";
import { tradeJobAllowed } from "../src/lib/trade-view.core";

const tables: Tables = {};
const shim = memoryPostgrest(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => shim.from(t), rpc: async () => ({ data: null, error: null }) } }));

const { tradeContext, requireTradeJob, tradeHome, moneyOrThrow, bossOrThrow, tradeAddTeamPerson, tradeSetWhoBooks } = await import("../src/lib/trade-view.server");

const NOW = new Date("2026-11-03T03:00:00.000Z");
const B1 = "00000000-0000-4000-8000-0000000000b1";
const U_BOSS = "00000000-0000-4000-8000-0000000000u1", U_OFFICE = "00000000-0000-4000-8000-0000000000u2", U_OFFICE_MONEY = "00000000-0000-4000-8000-0000000000u4";
const J1 = "00000000-0000-4000-8000-000000000001", J2 = "00000000-0000-4000-8000-000000000002";
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  const job = (id: string, n: number) => ({ id, job_number: `HV-${1000 + n}`, stage: "ready_check_ready_to_schedule", source: "website", channel: "hivic_sourced", qa_archived_at: null, deleted_at: null, updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null, originating_installer_business_id: null, installation_completed_at: null });
  Object.assign(tables, {
    businesses: [{ id: B1, name: "Inst Co", trading_name: null, business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: null, mitti_account_invited: true, in_house: true, pays_own_electricians: true }],
    business_members: [
      { id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true, can_see_money: false },
      { id: "m2", business_id: B1, user_id: U_OFFICE, member_role: "office", active: true, can_see_money: false },
      { id: "m3", business_id: B1, user_id: U_OFFICE_MONEY, member_role: "office", active: true, can_see_money: true },
    ],
    user_roles: [{ user_id: U_BOSS, role: "installer" }, { user_id: U_OFFICE, role: "installer" }, { user_id: U_OFFICE_MONEY, role: "installer" }],
    profiles: [{ id: U_BOSS, full_name: "Bea Boss", phone: null, email: "bea@example.com" }, { id: U_OFFICE, full_name: "Mia Office", phone: null, email: "mia@example.com" }, { id: U_OFFICE_MONEY, full_name: "Max Office", phone: null, email: "max@example.com" }],
    owners: [{ id: "o1", full_name: "Owner One" }, { id: "o2", full_name: "Owner Two" }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Suburb1", postcode: "3220" }, { id: "p2", address_line: "2 Test St", suburb: "Suburb2", postcode: "3220" }],
    jobs: [job(J1, 1), job(J2, 2)],
    // Both jobs are the BOSS's assignments: nothing names the Office person.
    job_assignments: [{ id: "a1", job_id: J1, business_id: B1, user_id: U_BOSS, role: "installer", active: true, assigned_at: at(-3) }, { id: "a2", job_id: J2, business_id: B1, user_id: U_BOSS, role: "installer", active: true, assigned_at: at(-2) }],
    partner_offers: [], bookings: [], evidence_requirements: [], job_piesa_deadlines: [], workflow_events: [], quotes: [], quote_items: [], quote_internals: [], invoices: [],
    appointment_proposals: [], assessment_payments: [], payment_overrides: [], ready_check_windows: [], ceiling_measurements: [], assessments: [], installer_declarations: [], piesa_records: [], documents: [],
    workflow_settings: [{ id: 1, due_trade_reply_warn_hours: 24, due_trade_reply_exception_hours: 48, due_owner_reminder_days: 3, due_owner_flag_days: 7 }],
    rate_cards: [], rate_card_items: [], electrician_rates: [], partner_workers: [],
  });
}

beforeAll(() => { setSystemTime(NOW); seed(); });
afterAll(() => { setSystemTime(); });

describe("Office role: reads and bookings like the boss", () => {
  test("pure rule: boss and office see the business's jobs; nobody else", () => {
    expect(seesBusinessJobs("boss")).toBe(true);
    expect(seesBusinessJobs("office")).toBe(true);
    expect(seesBusinessJobs("none")).toBe(false);
    const asg = [{ job_id: J1, business_id: B1, user_id: U_BOSS, active: true }];
    expect(tradeJobAllowed({ signedIn: true, userId: U_OFFICE, businessId: B1, boss: false, office: true, jobId: J1, assignments: asg })).toBe(true);
    expect(tradeJobAllowed({ signedIn: true, userId: U_OFFICE, businessId: B1, boss: false, jobId: J1, assignments: asg })).toBe(false);
    expect(tradeJobAllowed({ signedIn: true, userId: U_OFFICE, businessId: "other", boss: false, office: true, jobId: J1, assignments: asg })).toBe(false);
  });

  test("context: office is not boss, sees prices, sees the business's jobs; Money only with the switch", async () => {
    const c = (await tradeContext(U_OFFICE))!;
    expect(c.role).toBe("office");
    expect(c.boss).toBe(false);
    expect(c.prices).toBe(true);
    expect(c.money).toBe(false);
    expect(c.seesJobs).toBe(true);
    expect((await tradeContext(U_OFFICE_MONEY))!.money).toBe(true);
  });

  test("My work: the Office person sees every job assigned to the business (both are the boss's assignments)", async () => {
    const home = await tradeHome(U_OFFICE);
    expect(home.myWork?.all.map((c) => c.jobId).sort()).toEqual([J1, J2]);
    expect(home.boss).toBe(false);
    expect(home.role).toBe("office");
  });

  test("job page access: requireTradeJob lets the Office person open a job the boss is assigned to", async () => {
    const c = await requireTradeJob(U_OFFICE, J1);
    expect(c.checkedFor).toEqual({ userId: U_OFFICE, jobId: J1 });
    expect(c.role).toBe("office");
  });

  test("Money: refused without the switch, allowed with it", async () => {
    await expect(moneyOrThrow(U_OFFICE)).rejects.toThrow("Only the business owner can see this.");
    expect((await moneyOrThrow(U_OFFICE_MONEY)).role).toBe("office");
  });

  test("Team and business settings stay boss-only", async () => {
    await expect(bossOrThrow(U_OFFICE)).rejects.toThrow("Only the business owner can see this.");
    await expect(tradeAddTeamPerson(U_OFFICE, { name: "New Person", role: "crew", mobile: "0412345678", email: null, licenceNumber: null, dateOfBirth: "1990-01-01" })).rejects.toThrow("Only the business owner can see this.");
    await expect(tradeSetWhoBooks(U_OFFICE, "office")).rejects.toThrow("Only the business owner can see this.");
  });
});

describe("Office role: bookings", () => {
  // bookingTeam / requireTeam (in-house-booking.server): the first guard is the role; the rest of the read is mocked away so
  // the office person's refusal (or not) is the only thing tested.
  function load(role: "boss" | "office" | "none", kind: "installer" | "electrician" = "installer") {
    const deps: Record<string, unknown> = {
      "@/integrations/supabase/client.server": { supabaseAdmin: { from: () => { throw new Error("no reads expected"); } } },
      "./in-house-booking.core": {}, "./mitti-create-claim.core": {},
      "./trade-view.server": { requireTradeJob: async () => ({ boss: role === "boss", role, kind, biz: { id: B1 } }) },
      "./in-house-suppression.server": { readInHouseDispatchState: async () => { throw new Error("REACHED_HELD_CHECK"); } },
    };
    const api: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
    new Function("exports", "require", ts.transpile(readFileSync("src/lib/in-house-booking.server.ts", "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in deps)) throw new Error(`Unmocked ${p}`); return deps[p]; });
    return api;
  }
  test("bookingTeam: boss and office pass the role guard (the in-house check runs next); a plain member does not", async () => {
    await expect(load("boss")["bookingTeam"]!("j", U_BOSS)).rejects.toThrow("REACHED_HELD_CHECK");
    await expect(load("office")["bookingTeam"]!("j", U_OFFICE)).rejects.toThrow("REACHED_HELD_CHECK");
    await expect(load("none")["bookingTeam"]!("j", "u-none")).rejects.toThrow("Only the installer office can book these visits.");
    await expect(load("office", "electrician")["bookingTeam"]!("j", U_OFFICE)).rejects.toThrow("Only the installer office can book these visits.");
  });
});

describe("the job page branches on the page's role, not my_job_role", () => {
  const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
  test("InstallerFlow is chosen from getTradeJobPage's kind (an Office person has no my_job_role)", () => {
    expect(page).toMatch(/page\?\.kind === "installer"/);
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toMatch(/role: c\.role, kind: c\.kind,/);
  });
  test("visit allocation (the booking's hand-over of the form) lets the Office person through like the boss", () => {
    const va = readFileSync("src/lib/visit-allocation.server.ts", "utf8");
    expect(va).toContain('const books = c.boss || c.role === "office"');
    expect(va).toContain("if (!books && !staffLeadChange) throw");
    expect(va).toContain("return { canAllocate: books, visits };");
  });
  test("the overview read falls back to the business-scoped trade access when my_job_role has no answer", () => {
    expect(readFileSync("src/lib/job-overview.server.ts", "utf8")).toContain("requireTradeJob(userId, jobId)");
  });
});
