// Installer screens speed, Task 8: the Money screen loaders (`tradeMoney` behind getTradeMoneyView — the one call the Money
// page waits for — `tradeMoneyExtras` and `tradeMoneyJob` behind the per-job pay detail) read in few sequential rounds,
// return the same value as before (installer owner, electrician owner; normal, in-house and TEST), keep the TEST/real rule,
// keep staff refused before any money is read, and keep their failure rules (money/payout-gate reads fail the loader where
// they do today; the in-house display reads keep their catch). REAL server modules against an in-memory database
// (tests/helpers/memory-postgrest.ts). Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};

// ---- Round counter: every read waits for the next timer tick; reads issued before that tick share a round. ----
let wave = 0;
let log: { table: string; sel: string; wave: number; where: string }[] = [];
let pending: (() => void)[] = [];
let scheduled = false;
let failWhen: ((table: string, sel: string, info: string) => boolean) | null = null;
const DEBUG = !!process.env["ROUNDS_DEBUG"];
function flush() { scheduled = false; wave++; const p = pending; pending = []; for (const f of p) f(); }
function where() {
  if (!DEBUG) return "";
  return (new Error().stack ?? "").split("\n").filter((l) => l.includes("/src/lib/")).slice(0, 3).map((l) => l.trim().replace(/^at /, "").replace(/\(.*\/src\/lib\//, "(").replace(/:\d+\)$/, ")")).join(" < ");
}
function later<T>(table: string, sel: string, info: string, run: () => Promise<T> | T, failed: T, at = where()): Promise<T> {
  return new Promise((resolve) => {
    log.push({ table, sel, wave, where: at });
    const fail = failWhen?.(table, sel, info) ?? false;
    pending.push(() => resolve(fail ? failed : run()));
    if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
  });
}
function from(table: string) {
  const q = memoryPostgrest(tables).from(table);
  const at = where();
  let sel = "*";
  let info = "";
  const select = q.select;
  q.select = (c?: string, o?: unknown) => { sel = c ?? "*"; return select(c, o); };
  for (const m of ["eq", "contains", "in"] as const) {
    const orig = q[m];
    q[m] = (c: string, v: unknown) => { info += ` ${m} ${c} ${JSON.stringify(v)}`; return orig(c, v); };
  }
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => later(table, sel, info, () => q.run(), { data: null, count: null, error: { message: "read failed" } }, at).then(res, rej);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: (name: string) => later(`rpc:${name}`, "", "", () => ({ data: null, error: null }), { data: null, error: { message: "read failed" } }), storage: { from: () => ({}) } } }));

const { tradeMoney, tradeMoneyExtras, tradeMoneyJob } = await import("../src/lib/trade-view.server");

function reset() { wave = 0; log = []; pending = []; scheduled = false; }
const rounds = () => (log.length ? Math.max(...log.map((l) => l.wave)) + 1 : 0);
const roundsOf = (l: typeof log) => [...new Set(l.map((x) => x.wave))].sort((a, b) => a - b).map((w) => `${w + 1}: ${l.filter((x) => x.wave === w).map((x) => DEBUG ? `\n     ${x.table} [${x.where}]` : x.table).join(", ")}`).join("\n");
async function measured<T>(f: () => Promise<T>) {
  reset();
  const out = await f();
  const r = rounds(), l = log;
  if (DEBUG) console.log(`rounds = ${r}\n${roundsOf(l)}`);
  return { out, rounds: r, log: l };
}

// ---- Data ----
const NOW = new Date("2026-10-29T03:00:00.000Z");
const B1 = "00000000-0000-4000-8000-0000000000b1", B2 = "00000000-0000-4000-8000-0000000000b2";
const U_BOSS = "00000000-0000-4000-8000-0000000000a1", U_STAFF = "00000000-0000-4000-8000-0000000000a2", U_ELEC = "00000000-0000-4000-8000-0000000000a3", U_ESTAFF = "00000000-0000-4000-8000-0000000000a4";
/** J1, J2: installs done by the installer (J1 paid, J2 waiting); J3: the electrician's safety check + fixes on an installer
 *  job (in-house mode: the installer pays its own electricians). */
const J1 = "00000000-0000-4000-8000-000000000001", J2 = "00000000-0000-4000-8000-000000000002", J3 = "00000000-0000-4000-8000-000000000003";
const rowsOf = (t: Tables) => JSON.stringify(Object.fromEntries(Object.entries(t).filter(([, v]) => v.length)));
const at = (days: number, hour = 0) => new Date(NOW.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();

/** Normal mode: J2 is the qa_test job. TEST mode: J1 is the qa_test job and J2, J3 are real. */
function seed(opts: { test?: boolean; inHouse?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  const src = (id: string) => (opts.test ? (id === J1 ? "qa_test" : "website") : id === J2 ? "qa_test" : "website");
  const job = (id: string, n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id, job_number: `HV-${1000 + n}`, stage, source: src(id), channel: "hivic_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null,
    originating_installer_business_id: null, installation_completed_at: null, ...extra,
  });
  const ids = [J1, J2, J3];
  Object.assign(tables, {
    businesses: [
      { id: B1, name: "Inst Co", legal_name: "Inst Co Pty Ltd", trading_name: null, business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: true, in_house: opts.inHouse === true, pays_own_electricians: opts.inHouse === true },
      { id: B2, name: "Sparky Co", legal_name: null, trading_name: "Sparky", business_type: "rec", capabilities: ["electrician"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: false, in_house: false, pays_own_electricians: false },
    ],
    business_members: [
      { id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true },
      { id: "m2", business_id: B1, user_id: U_STAFF, member_role: "member", active: true },
      { id: "m3", business_id: B2, user_id: U_ELEC, member_role: "business_admin", active: true },
      { id: "m4", business_id: B2, user_id: U_ESTAFF, member_role: "member", active: true },
    ],
    user_roles: [{ user_id: U_BOSS, role: "installer" }, { user_id: U_STAFF, role: "installer" }, { user_id: U_ELEC, role: "electrician" }, { user_id: U_ESTAFF, role: "electrician" }],
    profiles: [
      { id: U_BOSS, full_name: "Bea Boss", phone: null, email: "bea@example.com" }, { id: U_STAFF, full_name: "Sam Staff", phone: null, email: "sam@example.com" },
      { id: U_ELEC, full_name: "Eli Spark", phone: null, email: "eli@example.com" }, { id: U_ESTAFF, full_name: "Ed Spark", phone: null, email: "ed@example.com" },
    ],
    owners: ids.map((_, i) => ({ id: `o${i + 1}`, full_name: `Owner Number${i + 1}` })),
    properties: ids.map((_, i) => ({ id: `p${i + 1}`, address_line: `${i + 1} Test St`, suburb: `Suburb${i + 1}`, postcode: "3220" })),
    jobs: [
      job(J1, 1, "ready_for_veec"),
      job(J2, 2, "installation_complete"),
      job(J3, 3, "installation_booked", { channel: "installer_sourced", originating_installer_business_id: B1, electrician_choice: "usual" }),
    ],
    job_assignments: [
      ...[J1, J2].map((id, i) => ({ id: `a${i}`, job_id: id, business_id: B1, user_id: U_STAFF, role: "installer", active: true })),
      { id: "a3", job_id: J3, business_id: B1, user_id: U_BOSS, role: "installer", active: true },
      { id: "e3", job_id: J3, business_id: B2, user_id: U_ESTAFF, role: "electrician", active: true },
    ],
    partner_offers: [
      { id: "of1", job_id: J1, business_id: B1, kind: "installer", status: "accepted", summary: { installer_pay_inc_gst: 1200 }, expires_at: at(-9), offered_at: at(-10) },
      { id: "of2", job_id: J3, business_id: B2, kind: "piesa", status: "accepted", summary: { electrician_rate_inc_gst: 330 }, expires_at: at(-9), offered_at: at(-10) },
    ],
    bookings: [
      { id: "in1", job_id: J1, business_id: B1, kind: "installation", status: "completed", scheduled_start: at(-6), scheduled_end: at(-6, 6) },
      { id: "in2", job_id: J2, business_id: B1, kind: "installation", status: "completed", scheduled_start: at(-2), scheduled_end: at(-2, 6) },
      { id: "rc1", job_id: J1, business_id: B1, kind: "ready_check", status: "completed", scheduled_start: at(-20), scheduled_end: at(-20, 1) },
      { id: "as3", job_id: J3, business_id: B2, kind: "assessment", status: "confirmed", scheduled_start: at(-8), scheduled_end: at(-8, 1) },
      { id: "rx3", job_id: J3, business_id: B2, kind: "rectification", status: "completed", scheduled_start: at(-4), scheduled_end: at(-4, 2) },
    ],
    workflow_events: [
      { id: "w1", job_id: J1, event_type: "stage_changed", to_stage: "ready_for_veec", created_at: at(-3), details: {} },
      { id: "w2", job_id: J1, event_type: "payout_marked_paid", created_at: at(-1, 2), details: { amount: 1150, kind: "installation" } },
      { id: "w3", job_id: J3, event_type: "mitti_electrician_recorded", created_at: at(-9), details: { choice: "usual" } },
      { id: "w4", job_id: J1, event_type: "visit_allocated", created_at: at(-7), details: { visit: "install", worker_name: "Sam Staff" } },
      { id: "w5", job_id: J2, event_type: "install_evidence_synced", created_at: at(-1), details: { summary: { blockers: [] } } },
      { id: "w6", job_id: J3, event_type: "electrician_form_approved", created_at: at(-7), details: { kind: "assessment", booking_id: "as3" } },
    ],
    quotes: [
      { id: "q1", job_id: J1, kind: "installation", status: "accepted", created_at: at(-12) },
      { id: "q2", job_id: J2, kind: "installation", status: "accepted", created_at: at(-12) },
      { id: "q3", job_id: J3, kind: "rectification", status: "accepted", created_at: at(-6) },
    ],
    quote_items: [{ id: "qi1", quote_id: "q1", code: "PIESA", description: "Safety check" }, { id: "qi3", quote_id: "q3", code: "FIX", description: "Electrical rectification: junction box" }],
    quote_internals: [{ id: "qn1", quote_id: "q1", cost_ex_gst: 1000 }, { id: "qn2", quote_id: "q2", cost_ex_gst: 1500 }, { id: "qn3", quote_id: "q3", cost_ex_gst: 200 }],
    invoices: [
      { id: "i1", job_id: J1, kind: "installation", status: "paid", balance_paid_at: at(-4), paid_at: at(-4), updated_at: at(-4) },
      { id: "i2", job_id: J2, kind: "installation", status: "authorised", balance_paid_at: null, paid_at: null, updated_at: at(-2) },
    ],
    assessments: [{ id: "as3", job_id: J3, external_mitti_id: "m3", mitti_completed: true, mitti_raw_snapshot: [], mitti_synced_at: at(-8), mitti_modified_at: at(-8) }],
    piesa_records: [{ id: "pr3", job_id: J3, created_at: at(-8), external_mitti_id: "m3" }],
    installer_declarations: [
      { id: "d1", job_id: J1, status: "signed", signed_at: at(-6), installer_name: "Sam Staff", installed_product: "Batts R4.0", installed_area_m2: 88 },
      { id: "d2", job_id: J2, status: "signed", signed_at: at(-2), installer_name: "Bea Boss", installed_product: "Batts R5.0", installed_area_m2: 70 },
    ],
    customer_assignments: [{ id: "ca1", job_id: J1, record_kind: "final_veec_assignment", status: "signed", installer_signed_at: at(-5), consumer_final_signed_at: at(-4), installed_product: "Batts R4.0", installed_area_m2: 90, created_at: at(-5) }],
    ceiling_measurements: [
      { id: "cm1", job_id: J1, is_current: true, measured_area_m2: 92, removal_m2: 10, removal_required: true },
      { id: "cm2", job_id: J2, is_current: true, measured_area_m2: 71, removal_m2: null, removal_required: false },
    ],
    business_bank_details: [
      { id: "bb1", business_id: B1, account_name: "Inst Co Trading", account_number: "12345678", bsb: "063-123" },
      { id: "bb2", business_id: B2, account_name: null, account_number: "99887766", bsb: "033" },
    ],
    rate_cards: [{ id: "rcd1", business_id: B1, version: 2, effective_from: "2026-01-01", is_active: true }],
    rate_card_items: [{ id: "rci1", rate_card_id: "rcd1", code: "PIESA", unit_price_ex_gst: 300 }],
    electrician_rates: [{ id: "er1", business_id: B2, service_type: "piesa", status: "active", rate_inc_gst: 330, effective_from: "2026-01-01" }],
    workflow_settings: [{ id: 1 }],
  });
}

beforeAll(async () => {
  setSystemTime(NOW);
  seed({ inHouse: true });
  // Warm the module cache so the rounds count reads, not first module loads.
  for (const u of [U_BOSS, U_ELEC]) { await tradeMoney(u); await tradeMoneyExtras(u); }
  await tradeMoneyJob(J1, U_BOSS); await tradeMoneyJob(J3, U_ELEC);
});
afterAll(() => { setSystemTime(); });

const outcome = async <T,>(f: () => Promise<T>) => { try { return { ok: await f() }; } catch (e) { return { refused: (e as Error).message }; } };

async function all(mode: { test?: boolean; inHouse?: boolean }) {
  seed(mode);
  const out: Record<string, unknown> = {};
  for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF], ["electrician", U_ELEC], ["electrician staff", U_ESTAFF]] as const) {
    out[`money ${who}`] = await outcome(() => tradeMoney(u));
    out[`extras ${who}`] = await outcome(() => tradeMoneyExtras(u));
    for (const j of [J1, J2, J3]) out[`job ${who} ${j.slice(-1)}`] = await outcome(() => tradeMoneyJob(j, u));
  }
  return out;
}

describe("parity: same value as before, field for field", () => {
  test("tradeMoney, tradeMoneyExtras and tradeMoneyJob for owner, staff and electrician (normal, in-house and TEST)", async () => {
    failWhen = null;
    const out: Record<string, unknown> = {};
    for (const mode of [{}, { inHouse: true }, { test: true }] as const) out[JSON.stringify(mode)] = await all(mode);
    expect(out).toMatchSnapshot();
  });
});

// The Money page draws once tradeMoney answers (getTradeMoneyView); extras load beside it; the job detail opens from a row.
describe("rounds", () => {
  // Known limit (no database function, ruling 30 Oct): round 1 finds the business, round 2 its visits, round 3 the job-id
  // facts. An in-house installer's safety checks are kept only once its PIESA rate card is read (round 3), so its job-id
  // facts are round 4.
  for (const [mode, max, was] of [[{ inHouse: false }, 3, 4], [{ inHouse: true }, 4, 5]] as const) {
    test(`tradeMoney installer owner (${mode.inHouse ? "in-house" : "ordinary"}): at most ${max} sequential rounds (was ${was})`, async () => {
      failWhen = null; seed(mode);
      const r = await measured(() => tradeMoney(U_BOSS));
      expect(r.out.rows.length).toBeGreaterThan(0);
      if (r.rounds > max) console.log(`tradeMoney rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(max);
    });
    test(`tradeMoneyJob installer owner (${mode.inHouse ? "in-house" : "ordinary"}): at most ${max} sequential rounds (was ${was + 1})`, async () => {
      failWhen = null; seed(mode);
      const r = await measured(() => tradeMoneyJob(J1, U_BOSS));
      expect(r.out.found).toBe(true);
      if (r.rounds > max) console.log(`tradeMoneyJob rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(max);
    });
  }
  test("tradeMoney electrician owner: at most 3 sequential rounds (was 4)", async () => {
    failWhen = null; seed();
    const r = await measured(() => tradeMoney(U_ELEC));
    expect(r.out.rows.length).toBeGreaterThan(0);
    if (r.rounds > 3) console.log(`tradeMoney electrician rounds = ${r.rounds}\n${roundsOf(r.log)}`);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });
  test("tradeMoneyExtras: at most 2 sequential rounds (was 2)", async () => {
    failWhen = null; seed();
    const r = await measured(() => tradeMoneyExtras(U_BOSS));
    expect(r.rounds).toBeLessThanOrEqual(2);
  });
});

describe("TEST and real jobs never mix", () => {
  test("TEST business: Money shows only the qa_test job, never the real one", async () => {
    failWhen = null; seed({ test: true }); // J1 qa_test, J2 real
    const m = await tradeMoney(U_BOSS);
    expect(m.rows.map((r) => r.jobNumber)).toEqual(["HV-1001"]);
    expect((await tradeMoneyJob(J2, U_BOSS)).found).toBe(false);
    expect((await tradeMoneyJob(J1, U_BOSS)).found).toBe(true);
  });
});

const MONEY_TABLES = ["bookings", "business_bank_details", "invoices", "quotes", "partner_offers", "electrician_rates", "rate_cards", "rate_card_items", "installer_declarations", "customer_assignments", "ceiling_measurements"];

describe("staff are refused before any money is read", () => {
  for (const [who, u] of [["installer staff", U_STAFF], ["electrician staff", U_ESTAFF]] as const) {
    test(`${who}: Money refused with the exact message, no money read made, nothing written`, async () => {
      failWhen = null; seed({ inHouse: true });
      const before = rowsOf(tables);
      reset();
      await expect(tradeMoney(u)).rejects.toThrow("Money is only shown to the business owner.");
      await new Promise((r) => setTimeout(r, 5));
      expect(log.map((l) => l.table).filter((t) => MONEY_TABLES.includes(t) || (t === "workflow_events"))).toEqual([]);
      reset();
      await expect(tradeMoneyExtras(u)).rejects.toThrow("Only the business owner can see this.");
      await expect(tradeMoneyJob(J1, u)).rejects.toThrow("Only the business owner can see this.");
      await new Promise((r) => setTimeout(r, 5));
      expect(log.map((l) => l.table).filter((t) => MONEY_TABLES.includes(t) || (t === "workflow_events"))).toEqual([]);
      expect(rowsOf(tables)).toBe(before);
    });
  }
  test("no business: the sign-in refusal wins on every Money loader", async () => {
    failWhen = null; seed();
    tables["business_members"] = tables["business_members"]!.filter((m) => m["user_id"] !== U_STAFF);
    for (const f of [() => tradeMoney(U_STAFF), () => tradeMoneyExtras(U_STAFF), () => tradeMoneyJob(J1, U_STAFF)]) await expect(f()).rejects.toThrow("Your sign-in isn't linked to an approved business yet.");
  });
  test("owner of another business: the job detail is refused (job not assigned), nothing written", async () => {
    failWhen = null; seed();
    const before = rowsOf(tables);
    await expect(tradeMoneyJob(J1, U_ELEC)).rejects.toThrow("This job isn't assigned to you.");
    expect(rowsOf(tables)).toBe(before);
  });
});

describe("failure rules unchanged", () => {
  test("a failed payout-gate (money) read fails Money and the job detail, as today", async () => {
    seed();
    failWhen = (t) => t === "installer_declarations" ;
    await expect(tradeMoney(U_BOSS)).rejects.toThrow("Could not read installer_declarations for the payout check");
    failWhen = (t, s) => t === "installer_declarations" && s === "job_id";
    await expect(tradeMoneyJob(J1, U_BOSS)).rejects.toThrow("Could not read installer_declarations for the payout check");
    failWhen = null;
  });
  test("a failed safety-visit (money) read fails the electrician's Money, as today", async () => {
    seed();
    failWhen = (t) => t === "piesa_records";
    await expect(tradeMoney(U_ELEC)).rejects.toThrow("Could not read piesa_records for the payout check");
    failWhen = null;
  });
  test("a failed in-house payer read keeps its display catch: Money still answers (safety checks not kept)", async () => {
    seed({ inHouse: true });
    const ok = await tradeMoney(U_BOSS);
    failWhen = (t, s) => t === "businesses" && s.includes("pays_own_electricians");
    const m = await tradeMoney(U_BOSS);
    failWhen = null;
    expect(m.rows.length).toBeGreaterThan(0);
    expect(m.rows.length + m.paidByInstaller.length).toBeLessThanOrEqual(ok.rows.length + ok.paidByInstaller.length);
  });
  test("a failed access read refuses the job detail before any job data is returned", async () => {
    seed();
    failWhen = (t, s) => t === "job_assignments" && s.includes("user_id, active");
    await expect(tradeMoneyJob(J1, U_BOSS)).rejects.toThrow("This job isn't assigned to you.");
    failWhen = null;
  });
});
