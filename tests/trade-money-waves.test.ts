// Portal speed step 1, Task 7: installer/electrician Money (`tradeMoney`, and the shared money rows behind My work's "This
// month" and the job's money detail) reads in few sequential waves after the sign-in context and returns the same value as
// before — including safety checks paid by an installer that pays its own electricians (installer-supplied and older jobs),
// and the failure rules (money reads fail the page; the in-house payer and payee reads keep their catch). Also the shared
// payee readers (`installerSafetyCheckBusinessesFor`, `safetyCheckPayeesFor`) give the same answers and errors. REAL server
// modules against an in-memory database with a wave counter (tests/helpers/wave-counter.ts). The fixture is the
// trade-money-speed one plus an older (no channel) job and a recorded quote PIESA price. Run on its own.
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Tables } from "./helpers/memory-postgrest";
import { outcome, waveCounter } from "./helpers/wave-counter";
import { addForeignBusiness, foreignTraces } from "./helpers/business-scope";

const tables: Tables = {};
const wc = waveCounter(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: wc.client }));

const { tradeMoney, tradeMoneyJob, partnerPayStates } = await import("../src/lib/trade-view.server");
const pe = await import("../src/lib/installer-paid-electricians.server");

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

const J4 = "00000000-0000-4000-8000-000000000004";
/** J4: an older job (no channel) from the installer, safety check done by the electrician, the installer's own electrician
 *  recorded (paid by the installer in in-house mode). J3 also gets an issued installation quote with a recorded PIESA price. */
function seedAll(opts: { test?: boolean; inHouse?: boolean } = {}) {
  seed(opts);
  tables["jobs"]!.push({ id: J4, job_number: "HV-1004", stage: "installation_booked", source: opts.test ? "qa_test" : "website", channel: null, qa_archived_at: null, deleted_at: null,
    updated_at: at(-4), next_action: null, created_at: at(-30), owner_id: "o4", property_id: "p4", electrician_choice: null, originating_installer_business_id: B1, installation_completed_at: null });
  tables["owners"]!.push({ id: "o4", full_name: "Owner Number4" });
  tables["properties"]!.push({ id: "p4", address_line: "4 Test St", suburb: "Suburb4", postcode: "3220" });
  tables["job_assignments"]!.push({ id: "a4", job_id: J4, business_id: B1, user_id: U_BOSS, role: "installer", active: true }, { id: "e4", job_id: J4, business_id: B2, user_id: U_ESTAFF, role: "electrician", active: true });
  tables["bookings"]!.push({ id: "as4", job_id: J4, business_id: B2, kind: "assessment", status: "completed", scheduled_start: at(-5), scheduled_end: at(-5, 1) });
  tables["workflow_events"]!.push({ id: "w7", job_id: J4, event_type: "mitti_electrician_recorded", created_at: at(-6), details: { choice: "usual" } });
  tables["quotes"]!.push({ id: "q3i", job_id: J3, kind: "installation", status: "issued", created_at: at(-7) });
  tables["quote_items"]!.push({ id: "qi3i", quote_id: "q3i", code: "PIESA", description: "Safety check", line_total_inc_gst: 360 });
}

const PEOPLE = [["owner", U_BOSS], ["staff", U_STAFF], ["electrician", U_ELEC], ["electrician staff", U_ESTAFF]] as const;
const MODES = [{}, { inHouse: true }, { test: true }, { test: true, inHouse: true }] as const;

beforeAll(async () => {
  setSystemTime(NOW);
  seedAll({ inHouse: true });
  for (const u of [U_BOSS, U_ELEC]) { await outcome(() => tradeMoney(u)); await outcome(() => tradeMoneyJob(J3, u)); } // warm the module cache (Part 6: the electrician is refused)
});
afterAll(() => { setSystemTime(); });

async function all(mode: { test?: boolean; inHouse?: boolean }) {
  seedAll(mode);
  const out: Record<string, unknown> = {};
  for (const [who, u] of PEOPLE) {
    out[`money ${who}`] = await outcome(() => tradeMoney(u));
    for (const jb of [J1, J3, J4]) out[`job ${who} ${jb.slice(-1)}`] = await outcome(() => tradeMoneyJob(jb, u));
  }
  for (const [b, k] of [[B1, "installer"], [B2, "electrician"]] as const) out[`pay states ${k}`] = await outcome(() => partnerPayStates(b, k, !!mode.test));
  return out;
}

/** The shared payee readers, called directly (office Payouts, quotes and invoices use them too). */
async function payeeReads() {
  const m = <K, V>(x: Map<K, V>) => [...x.entries()];
  return {
    "businesses B1,B2,unknown": await outcome(async () => m(await pe.installerSafetyCheckBusinessesFor([B1, B2, "00000000-0000-4000-8000-0000000000ff"]))),
    "businesses none": await outcome(async () => m(await pe.installerSafetyCheckBusinessesFor([]))),
    "own electrician businesses": await outcome(async () => m(await pe.ownElectricianBusinessesFor([B1, B2]))),
    "readInstallerPaidElectricians B1": await outcome(() => pe.readInstallerPaidElectricians(B1)),
    "payees J3 (installer-supplied) + J4 (older) + J1 (ours)": await outcome(async () => m(await pe.safetyCheckPayeesFor([
      { id: J3, channel: "installer_sourced", originating_installer_business_id: B1 }, { id: J4, channel: null, originating_installer_business_id: B1 }, { id: J1, channel: "hivic_sourced", originating_installer_business_id: null }]))),
    "payees J4 only": await outcome(async () => m(await pe.safetyCheckPayeesFor([{ id: J4, channel: null, originating_installer_business_id: B1 }]))),
    "payees installer-supplied, no originating installer": await outcome(async () => m(await pe.safetyCheckPayeesFor([{ id: J3, channel: "installer_sourced", originating_installer_business_id: null }]))),
  };
}

/** Money reads (fail the page), display reads (keep their catch), and the payee readers' own reads. */
const FAILURES: [string, NonNullable<typeof wc.state.failWhen>][] = [
  ["payout gate", (t) => t === "installer_declarations"],
  ["safety visits", (t) => t === "piesa_records"],
  ["payer businesses", (t, s) => t === "businesses" && s.includes("pays_own_electricians")],
  ["rate cards", (t) => t === "rate_cards"],
  ["rate card lines", (t) => t === "rate_card_items"],
  ["recorded quote prices", (t, s) => t === "quotes" && s.startsWith("job_id,quote_items")],
  ["electrician choices", (t, _s, i) => t === "workflow_events" && i.includes("mitti_electrician_recorded")],
  ["own visits", (t, _s, i) => t === "bookings" && i.includes("eq business_id")],
  ["their safety checks", (t, _s, i) => t === "bookings" && i.includes("originating_installer_business_id")],
  ["bank", (t) => t === "business_bank_details"],
];

const quiet = async <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => undefined; try { return await f(); } finally { console.error = e; } };

describe("Money (Task 7): same value as before", () => {
  test("Money, the job money detail and pay states: owner, staff and electrician (ordinary, in-house, TEST)", async () => {
    wc.state.failWhen = null;
    const out: Record<string, unknown> = {};
    for (const mode of MODES) out[JSON.stringify(mode)] = await all(mode);
    expect(out).toMatchSnapshot();
  });

  test("the shared payee readers (ordinary and in-house)", async () => {
    wc.state.failWhen = null;
    const out: Record<string, unknown> = {};
    for (const mode of [{}, { inHouse: true }] as const) { seedAll(mode); out[JSON.stringify(mode)] = await payeeReads(); }
    expect(out).toMatchSnapshot();
  });

  test("with each read failing: the same value or the same refusal (Money, My work's money rows, payee readers)", async () => {
    const out: Record<string, unknown> = {};
    for (const [name, f] of FAILURES) {
      seedAll({ inHouse: true });
      wc.state.failWhen = f;
      out[`${name}: money owner`] = await quiet(() => outcome(() => tradeMoney(U_BOSS)));
      out[`${name}: money electrician`] = await quiet(() => outcome(() => tradeMoney(U_ELEC)));
      out[`${name}: payee reads`] = await quiet(() => payeeReads());
    }
    wc.state.failWhen = null;
    expect(out).toMatchSnapshot();
  });

  test("the fixture exercises the payees (installer-paid safety checks, recorded and rate-card prices)", async () => {
    wc.state.failWhen = null; seedAll({ inHouse: true });
    const b = await tradeMoney(U_BOSS);
    expect(b.rows.filter((r) => r.kind === "assessment").map((r) => [r.jobNumber, r.amount])).toEqual(expect.arrayContaining([["HV-1003", 360], ["HV-1004", 330]]));
    // Part 6: electricians have no Money page — the installer-paid safety checks are now only on the installer's side.
    await expect(tradeMoney(U_ELEC)).rejects.toThrow("Money is only shown to installer businesses.");
  });
});

describe("Money (Task 7): waves after the sign-in context", () => {
  // Part 6: no electrician Money page, so only the installer owner is measured (the electrician is refused at the context).
  for (const [who, u, mode] of [["installer owner in-house", U_BOSS, { inHouse: true }], ["installer owner ordinary", U_BOSS, {}]] as const) {
    test(`tradeMoney ${who}: at most 3 waves after the sign-in context`, async () => {
      wc.state.failWhen = null; seedAll(mode);
      const r = await wc.measured(() => tradeMoney(u));
      expect(r.out.rows.length).toBeGreaterThan(0);
      console.log(`tradeMoney ${who}: ${r.afterCtx} waves after ctx (${r.waves} total)`);
      if (r.afterCtx > 3) console.log(wc.wavesOf(r.log));
      expect(r.afterCtx).toBeLessThanOrEqual(3);
    });
  }
});

// Portal speed step 2 (plan Review Focus 5): another business's sign-in, job, booking, offer, worker, credential, bank
// details and payout change nothing on this screen, for every caller.
describe("Money: business-scoped", () => {
  test("another business's rows never reach the answer", async () => {
    wc.state.failWhen = null;
    for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF], ["electrician", U_ELEC], ["in-house owner", U_BOSS]] as const) {
      seedAll(who === "in-house owner" ? { inHouse: true } : {});
      const before = await outcome(() => tradeMoney(u));
      addForeignBusiness(tables, at(-1));
      const after = await outcome(() => tradeMoney(u));
      expect({ who, traces: foreignTraces(after) }).toEqual({ who, traces: [] });
      expect(after).toEqual(before);
    }
  });
});
