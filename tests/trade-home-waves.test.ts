// Portal speed step 1, Task 5: installer My work (`tradeHome`) reads in few sequential waves after the sign-in context, and
// returns the same value as before — including the in-house install deposit line and the Mitti "choose your electrician"
// question, and their display catches. REAL server modules against an in-memory database (tests/helpers/memory-postgrest.ts)
// with a wave counter (tests/helpers/wave-counter.ts). The fixture is the trade-home-speed one plus deposit/Mitti jobs.
// Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Tables } from "./helpers/memory-postgrest";
import { outcome, waveCounter } from "./helpers/wave-counter";

const tables: Tables = {};
const wc = waveCounter(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: wc.client }));

const { tradeHome } = await import("../src/lib/trade-view.server");
// Modules the loader imports on first use: loaded now so a first module load never splits a wave.
await Promise.all([import("../src/lib/install-deposit-list.server"), import("../src/lib/mitti-electrician.server")]);

// ---- Data ----
const NOW = new Date("2026-10-29T03:00:00.000Z");
const B1 = "00000000-0000-4000-8000-0000000000b1", B2 = "00000000-0000-4000-8000-0000000000b2";
const U_BOSS = "00000000-0000-4000-8000-0000000000u1", U_STAFF = "00000000-0000-4000-8000-0000000000u2", U_ELEC = "00000000-0000-4000-8000-0000000000u3";
const j = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const at = (days: number, hour = 0) => new Date(NOW.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();

function seed(opts: { test?: boolean; inHouse?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  const src = (n: number) => (opts.test && n !== 9 ? "qa_test" : opts.test ? "website" : n === 9 ? "qa_test" : "website");
  const job = (n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id: j(n), job_number: `HV-${1000 + n}`, stage, source: src(n), channel: "hivic_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null,
    originating_installer_business_id: null, installation_completed_at: null, ...extra,
  });
  Object.assign(tables, {
    businesses: [
      { id: B1, name: "Inst Co", trading_name: null, business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: true, in_house: opts.inHouse === true, pays_own_electricians: opts.inHouse === true },
      { id: B2, name: "Sparky Co", trading_name: "Sparky", business_type: "rec", capabilities: ["electrician"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: false, in_house: false, pays_own_electricians: false },
    ],
    business_members: [
      { id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true },
      { id: "m2", business_id: B1, user_id: U_STAFF, member_role: "member", active: true },
      { id: "m3", business_id: B2, user_id: U_ELEC, member_role: "business_admin", active: true },
    ],
    user_roles: [{ user_id: U_BOSS, role: "installer" }, { user_id: U_STAFF, role: "installer" }, { user_id: U_ELEC, role: "electrician" }],
    profiles: [{ id: U_BOSS, full_name: "Bea Boss", phone: null, email: "bea@example.com" }, { id: U_STAFF, full_name: "Sam Staff", phone: null, email: "sam@example.com" }, { id: U_ELEC, full_name: "Eli Spark", phone: null, email: "eli@example.com" }],
    owners: Array.from({ length: 10 }, (_, i) => ({ id: `o${i + 1}`, full_name: `Owner Number${i + 1}` })),
    properties: Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, address_line: `${i + 1} Test St`, suburb: `Suburb${i + 1}`, postcode: "3220" })),
    jobs: [
      job(1, "ready_check_ready_to_schedule", { channel: "installer_sourced" }),
      job(2, "evidence_outstanding"),
      job(3, "installation_booked"),
      job(4, "cancelled"),
      job(5, "ready_for_veec", { originating_installer_business_id: B1, electrician_choice: "usual" }),
      job(6, "quote_sent", { qa_archived_at: at(-1) }),
      job(7, "complete"),
      job(8, "ready_check_complete", { channel: "installer_sourced", next_action: "Needs finishing: owner details" }),
      job(9, "ready_check_booking"),
      job(10, "complete"),
    ],
    job_assignments: [
      ...[1, 2, 3, 4, 5, 6, 8, 9, 10].map((n) => ({ id: `a${n}`, job_id: j(n), business_id: B1, user_id: [1, 3, 9].includes(n) ? U_STAFF : U_BOSS, role: "installer", active: true })),
      { id: "a7", job_id: j(7), business_id: B1, user_id: U_BOSS, role: "installer", active: false },
      ...[3, 5].map((n) => ({ id: `e${n}`, job_id: j(n), business_id: B2, user_id: U_ELEC, role: "electrician", active: true })),
    ],
    partner_offers: [
      { id: "of1", job_id: j(1), business_id: B1, kind: "ready_check", status: "pending", summary: { suburb: "Suburb1", approx_area_m2: 80 }, expires_at: at(1), offered_at: at(-1) },
      { id: "of2", job_id: j(3), business_id: B1, kind: "piesa", status: "pending", summary: {}, expires_at: at(1), offered_at: at(-2) },
      { id: "of3", job_id: j(5), business_id: B1, kind: "installer", status: "accepted", summary: { installer_pay_inc_gst: 1200 }, expires_at: at(-9), offered_at: at(-10) },
      { id: "of4", job_id: j(3), business_id: B2, kind: "piesa", status: "pending", summary: { suburb: "Suburb3" }, expires_at: at(1), offered_at: at(-1) },
    ],
    bookings: [
      { id: "bk1", job_id: j(3), business_id: B1, kind: "installation", status: "confirmed", scheduled_start: at(1), scheduled_end: at(1, 6) },
      { id: "bk2", job_id: j(5), business_id: B1, kind: "installation", status: "completed", scheduled_start: at(-2), scheduled_end: at(-2, 6) },
      { id: "bk3", job_id: j(5), business_id: B2, kind: "assessment", status: "confirmed", scheduled_start: at(-6), scheduled_end: at(-6, 1) },
      { id: "bk4", job_id: j(3), business_id: B2, kind: "assessment", status: "completed", scheduled_start: at(-3), scheduled_end: at(-3, 1) },
      { id: "bk5", job_id: j(9), business_id: B1, kind: "ready_check", status: "confirmed", scheduled_start: at(2), scheduled_end: at(2, 1) },
      { id: "bk6", job_id: j(9), business_id: B1, kind: "installation", status: "completed", scheduled_start: at(-1), scheduled_end: at(-1, 6) },
    ],
    evidence_requirements: [
      { id: "ev1", job_id: j(2), category: "photo", gate: "C", label: "Ceiling after", required: true, status: "outstanding" },
      { id: "ev2", job_id: j(2), category: "photo", gate: "C", label: "Roof space", required: true, status: "rejected" },
      { id: "ev3", job_id: j(2), category: "photo", gate: "C", label: "Optional", required: false, status: "outstanding" },
    ],
    job_piesa_deadlines: [{ job_id: j(3), install_deadline: "2026-11-20" }],
    workflow_events: [
      { id: "w1", job_id: j(5), event_type: "stage_changed", to_stage: "ready_for_veec", created_at: at(-1), details: {} },
      { id: "w2", job_id: j(5), event_type: "payout_marked_paid", created_at: at(-1, 2), details: { amount: 1150, kind: "installation" } },
      { id: "w3", job_id: j(8), event_type: "ready_check_basics", created_at: at(-1), details: { completed: true, answered: true } },
      { id: "w4", job_id: j(8), event_type: "quote_auto_send_held", created_at: at(-1, 1), details: { quote_id: "q8" } },
      { id: "w5", job_id: j(8), event_type: "installer_price_set", created_at: at(-1, 2), details: { price_inc_gst: 3000, inclusions: "Batts", entered_by: U_BOSS } },
      { id: "w6", job_id: j(5), event_type: "mitti_electrician_recorded", created_at: at(-8), details: { choice: "usual" } },
      { id: "w7", job_id: j(1), event_type: "stage_changed", to_stage: "ready_check_ready_to_schedule", created_at: at(-3), details: {} },
    ],
    quotes: [
      { id: "q8", job_id: j(8), kind: "installation", status: "draft", sent_at: null, accepted_at: null, release_state: "held", release_hold_reason: null, option_code: "A1", created_at: at(-1), subtotal_inc_gst: 3000, veec_discount_inc_gst: 0, customer_total_inc_gst: 3000 },
      { id: "q5", job_id: j(5), kind: "installation", status: "accepted", sent_at: at(-12), accepted_at: at(-11), release_state: "released", release_hold_reason: null, option_code: "A2", created_at: at(-12), subtotal_inc_gst: 4000, veec_discount_inc_gst: 0, customer_total_inc_gst: 4000 },
    ],
    quote_items: [{ id: "qi1", quote_id: "q5", code: "PIESA", description: "Safety check", explanation: null, quantity: 1, unit: "ea", unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 1 }],
    quote_internals: [{ id: "qn1", quote_id: "q5", cost_ex_gst: 1000 }],
    invoices: [{ id: "i5", job_id: j(5), kind: "installation", status: "paid", deposit_paid_at: at(-11), balance_paid_at: at(-1), paid_at: at(-1), total_paid: 4000, deposit_paid_amount: 349, deposit_amount: 349, created_at: at(-12), updated_at: at(-1) }],
    appointment_proposals: [], assessment_payments: [], payment_overrides: [], ready_check_windows: [],
    workflow_settings: [{ id: 1, due_trade_reply_warn_hours: 24, due_trade_reply_exception_hours: 48, due_owner_reminder_days: 3, due_owner_flag_days: 7 }],
    ceiling_measurements: [{ id: "cm8", job_id: j(8), external_source: "mitti", external_id: "audit-8", is_current: true }],
    assessments: [{ id: "as5", job_id: j(5), external_mitti_id: "m5", mitti_completed: true, mitti_raw_snapshot: [], mitti_synced_at: at(-5), mitti_modified_at: at(-5) }],
    installer_declarations: [{ id: "d5", job_id: j(5), status: "signed" }, { id: "d9", job_id: j(9), status: "signed" }],
    piesa_records: [{ id: "pr5", job_id: j(5), created_at: at(-5), external_mitti_id: "m5" }],
    rate_cards: [{ id: "rc1", business_id: B1, version: 2, effective_from: "2026-01-01", is_active: true }],
    rate_card_items: [{ id: "rci1", rate_card_id: "rc1", code: "PIESA", unit_price_ex_gst: 300 }],
    electrician_rates: [{ id: "er1", business_id: B2, service_type: "piesa", status: "active", rate_inc_gst: 330, effective_from: "2026-01-01" }],
  });
}

/** Deposit and Mitti jobs on top of the trade-home-speed fixture. Install scheduling (in-house mode: deposit line): J11 deposit
 *  not paid, J12 no invoice (unknown), J14 deposit paid; J13: installer-supplied, electrician already
 *  nominated (no question); J1 (installer-supplied, nothing chosen) asks the electrician question. */
function seedAll(opts: { test?: boolean; inHouse?: boolean } = {}) {
  seed(opts);
  const src = opts.test ? "qa_test" : "website";
  const more = (n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id: j(n), job_number: `HV-${1000 + n}`, stage, source: src, channel: "hivic_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null,
    originating_installer_business_id: null, installation_completed_at: null, ...extra,
  });
  tables["jobs"]!.push(more(11, "installation_scheduling"), more(12, "installation_scheduling"), more(13, "ready_check_ready_to_schedule", { channel: "installer_sourced" }), more(14, "installation_scheduling"), more(15, "ready_check_ready_to_schedule", { channel: "installer_sourced" }));
  for (const n of [11, 12, 13, 14, 15]) {
    tables["owners"]!.push({ id: `o${n}`, full_name: `Owner Number${n}` });
    tables["properties"]!.push({ id: `p${n}`, address_line: `${n} Test St`, suburb: `Suburb${n}`, postcode: "3220" });
    tables["job_assignments"]!.push({ id: `a${n}`, job_id: j(n), business_id: B1, user_id: n === 13 || n === 15 ? U_STAFF : U_BOSS, role: "installer", active: true });
  }
  tables["invoices"]!.push({ id: "i11", job_id: j(11), kind: "installation", status: "authorised", quote_id: "q11", total_inc_gst: 5000, total_paid: 100, deposit_paid_at: null, balance_paid_at: null, paid_at: null, deposit_paid_amount: null, deposit_amount: null, created_at: at(-3), updated_at: at(-3) });
  tables["invoices"]!.push({ id: "i14", job_id: j(14), kind: "installation", status: "authorised", quote_id: null, total_inc_gst: 4000, total_paid: 1000, deposit_paid_at: null, balance_paid_at: null, paid_at: null, deposit_paid_amount: null, deposit_amount: null, created_at: at(-3), updated_at: at(-3) });
  tables["quotes"]!.push({ id: "q11", job_id: j(11), kind: "installation", status: "accepted", sent_at: at(-5), accepted_at: at(-4), release_state: "released", release_hold_reason: null, option_code: "A2", created_at: at(-5) });
  tables["quote_items"]!.push({ id: "qi11", quote_id: "q11", code: "PIESA", description: "Safety check", line_total_inc_gst: 349 });
  tables["workflow_settings"]![0]!["safety_check_payment_inc_gst"] = 349;
  tables["electrician_nominations"] = [{ id: "n13", job_id: j(13), ended_at: null }];
}

beforeAll(async () => {
  setSystemTime(NOW);
  seedAll({ inHouse: true });
  for (const u of [U_BOSS, U_STAFF, U_ELEC]) await tradeHome(u); // warm the module cache
});
afterAll(() => { setSystemTime(); });

/** Display reads that keep their catch (deposit facts, Mitti question) and the reads whose failure fails the page. */
const FAILURES: [string, NonNullable<typeof wc.state.failWhen>][] = [
  ["deposit invoices", (t, s) => t === "invoices" && s.startsWith("id,job_id,quote_id")],
  ["deposit setting", (t, s) => t === "workflow_settings" && s === "safety_check_payment_inc_gst"],
  ["deposit PIESA lines", (t, s) => t === "quote_items" && s.startsWith("quote_id,code")],
  ["mitti jobs", (t, s) => t === "jobs" && s === "id, source, channel, electrician_choice"],
  ["mitti nominations", (t) => t === "electrician_nominations"],
  ["in-house state", (t, s) => t === "job_assignments" && s.includes("in_house")],
  ["payout gate (money)", (t) => t === "installer_declarations"],
];

const quiet = async <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => undefined; try { return await f(); } finally { console.error = e; } };

describe("My work (Task 5): same value as before", () => {
  test("owner, staff and electrician; in-house, ordinary and TEST", async () => {
    wc.state.failWhen = null;
    const out: Record<string, unknown> = {};
    for (const mode of [{ inHouse: true }, { inHouse: false }, { test: true, inHouse: true }] as const) {
      seedAll(mode);
      for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF], ["electrician", U_ELEC]] as const) out[`${JSON.stringify(mode)} ${who}`] = await outcome(() => tradeHome(u));
    }
    expect(out).toMatchSnapshot();
  });

  test("with each read failing: the same value or the same refusal", async () => {
    const out: Record<string, unknown> = {};
    for (const [name, f] of FAILURES) {
      seedAll({ inHouse: true });
      wc.state.failWhen = f;
      out[`${name} owner`] = await quiet(() => outcome(() => tradeHome(U_BOSS)));
      out[`${name} staff`] = await quiet(() => outcome(() => tradeHome(U_STAFF)));
    }
    wc.state.failWhen = null;
    expect(out).toMatchSnapshot();
  });

  test("the fixture exercises the deposit line and the electrician question", async () => {
    wc.state.failWhen = null; seedAll({ inHouse: true });
    const nextOf = async (u: string) => Object.fromEntries(Object.values((await tradeHome(u)).home!).flat().map((x) => [(x as { jobNumber: string }).jobNumber, (x as { next: string }).next]));
    const boss = await nextOf(U_BOSS), staff = await nextOf(U_STAFF);
    expect(boss["HV-1011"]).toBe("Next: owner to pay the 10% install deposit");
    expect(boss["HV-1012"]).toBe("Next: install deposit confirmation is being checked");
    expect(boss["HV-1014"]).toBe("Next: Book the install in the portal");
    expect(staff["HV-1015"]).toBe("Next: choose your electrician");
    expect(staff["HV-1013"]).not.toBe("Next: choose your electrician"); // electrician already nominated
  });
});

describe("My work (Task 5): waves after the sign-in context", () => {
  for (const [who, u, mode] of [["owner in-house", U_BOSS, { inHouse: true }], ["owner ordinary", U_BOSS, { inHouse: false }], ["staff in-house", U_STAFF, { inHouse: true }], ["electrician owner", U_ELEC, { inHouse: false }]] as const) {
    test(`${who}: at most 3 waves after the sign-in context`, async () => {
      wc.state.failWhen = null; seedAll(mode);
      const r = await wc.measured(() => tradeHome(u));
      console.log(`tradeHome ${who}: ${r.afterCtx} waves after ctx (${r.waves} total)`);
      if (r.afterCtx > 3) console.log(wc.wavesOf(r.log));
      expect(r.afterCtx).toBeLessThanOrEqual(3);
    });
  }
});
