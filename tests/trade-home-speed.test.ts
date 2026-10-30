// Installer screens speed, Task 5: the installer home loader (`tradeHome`) reads in few sequential rounds, returns the same
// value as before, keeps the TEST/real filter, and keeps its failure rules (money/payout gate fails the page; the in-house
// and quote display reads keep their catch). REAL server modules against an in-memory database
// (tests/helpers/memory-postgrest.ts). Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};

// ---- Round counter: every read waits for the next timer tick; reads issued before that tick share a round. ----
let wave = 0;
let log: { table: string; sel: string; wave: number }[] = [];
let pending: (() => void)[] = [];
let scheduled = false;
let failWhen: ((table: string, sel: string) => boolean) | null = null;
function flush() { scheduled = false; wave++; const p = pending; pending = []; for (const f of p) f(); }
function from(table: string) {
  const q = memoryPostgrest(tables).from(table);
  let sel = "*";
  const select = q.select;
  q.select = (c?: string, o?: unknown) => { sel = c ?? "*"; return select(c, o); };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => new Promise((resolve) => {
    log.push({ table, sel, wave });
    const fail = failWhen?.(table, sel) ?? false;
    pending.push(() => resolve(fail ? { data: null, error: { message: "read failed" } } : q.run()));
    if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
  }).then(res, rej);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));

const { tradeHome } = await import("../src/lib/trade-view.server");
const { installStartDate, installStartDates } = await import("../src/lib/install-evidence.server");
const { loadInstallerQuotes } = await import("../src/lib/installer-quote-status.server");
const { safetyCheckPayeesFor } = await import("../src/lib/installer-paid-electricians.server");

async function measured(userId: string) {
  wave = 0; log = []; pending = []; scheduled = false;
  const out = await tradeHome(userId);
  return { out, rounds: log.length ? Math.max(...log.map((l) => l.wave)) + 1 : 0, log };
}
const roundsOf = (l: typeof log) => [...new Set(l.map((x) => x.wave))].sort((a, b) => a - b).map((w) => `${w + 1}: ${l.filter((x) => x.wave === w).map((x) => x.table).join(", ")}`).join("\n");

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

beforeAll(async () => {
  setSystemTime(NOW);
  seed({ inHouse: true });
  await tradeHome(U_BOSS); // warm the module cache so later rounds count reads, not first module loads
});
afterAll(() => { setSystemTime(); });

describe("tradeHome speed (Task 5)", () => {
  test("same value as before, field for field (owner, staff, electrician, in-house and ordinary installer)", async () => {
    failWhen = null;
    const out: Record<string, unknown> = {};
    seed({ inHouse: true });
    out["owner in-house"] = (await measured(U_BOSS)).out;
    out["staff in-house"] = (await measured(U_STAFF)).out;
    out["electrician owner"] = (await measured(U_ELEC)).out;
    seed({ inHouse: false });
    out["owner ordinary"] = (await measured(U_BOSS)).out;
    out["staff ordinary"] = (await measured(U_STAFF)).out;
    seed({ test: true, inHouse: true });
    out["owner TEST"] = (await measured(U_BOSS)).out;
    out["staff TEST"] = (await measured(U_STAFF)).out;
    expect(out).toMatchSnapshot();
  });

  test("staff: the installer home loads in at most 3 sequential rounds of reads", async () => {
    failWhen = null; seed({ inHouse: true });
    const r = await measured(U_STAFF);
    expect(r.out.home).not.toBeNull();
    if (r.rounds > 3) console.log(`staff rounds = ${r.rounds}\n${roundsOf(r.log)}`);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });

  test("owner of an ordinary installer business: at most 3 sequential rounds", async () => {
    failWhen = null; seed({ inHouse: false });
    const r = await measured(U_BOSS);
    expect(r.out.month).not.toBeNull();
    if (r.rounds > 3) console.log(`owner (ordinary) rounds = ${r.rounds}\n${roundsOf(r.log)}`);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });

  test("owner of an in-house installer business (pays its own electricians): at most 5 sequential rounds", async () => {
    failWhen = null; seed({ inHouse: true });
    const r = await measured(U_BOSS);
    expect(r.out.month).not.toBeNull();
    if (r.rounds > 5) console.log(`owner (in-house) rounds = ${r.rounds}\n${roundsOf(r.log)}`);
    expect(r.rounds).toBeLessThanOrEqual(5);
  });

  test("electrician owner: at most 3 sequential rounds", async () => {
    failWhen = null; seed({ inHouse: false });
    const r = await measured(U_ELEC);
    if (r.rounds > 3) console.log(`electrician rounds = ${r.rounds}\n${roundsOf(r.log)}`);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });

  test("TEST business: only the qa_test job shows, never the real one", async () => {
    failWhen = null; seed({ test: true });
    // In TEST mode job 9 is the one real job; every other assigned job is qa_test.
    const { out } = await measured(U_BOSS);
    const ids = new Set([...out.jobs.map((x) => x.jobId), ...out.done.map((x) => x.jobId), ...out.yourMove.map((x) => x.jobId), ...out.coming.map((x) => x.jobId)]);
    expect(ids.has(j(9))).toBe(false);
    expect(ids.has(j(1))).toBe(true);
    expect(out.isTest).toBe(true);
  });

  test("a failed payout-gate (money) read fails the owner's page, as today", async () => {
    seed({ inHouse: true });
    failWhen = (t) => t === "installer_declarations";
    await expect(tradeHome(U_BOSS)).rejects.toThrow("Could not read installer_declarations");
    failWhen = null;
  });

  test("staff never read owner money: the same failing money read does not touch the staff page", async () => {
    seed({ inHouse: true });
    failWhen = (t) => t === "installer_declarations";
    const { out, log: l } = await measured(U_STAFF);
    failWhen = null;
    expect(out.month).toBeNull();
    // No owner money read at all: no payout gate, no money bookings, no accepted-quote costs.
    expect(l.some((x) => x.table === "installer_declarations" || x.sel.includes("quote_internals") || x.sel.includes("originating_installer_business_id, owners("))).toBe(false);
  });

  test("a failed in-house read keeps its display catch: the line says details are unavailable", async () => {
    seed({ inHouse: true });
    failWhen = (t, s) => t === "job_assignments" && s.includes("in_house");
    const { out } = await measured(U_STAFF);
    failWhen = null;
    expect(out.jobs.map((x) => x.jobId)).toContain(j(1));
    expect(JSON.stringify(out)).toContain("Visit booking details unavailable");
    const healthy = (await measured(U_STAFF)).out;
    expect(JSON.stringify(healthy)).not.toContain("Visit booking details unavailable");
    expect(JSON.stringify(healthy)).toContain("Book the Ready Check in the portal");
  });

  test("a failed quote read keeps its display catch: the page loads without quote lines", async () => {
    seed({ inHouse: false });
    failWhen = (t, s) => t === "quotes" && s.includes("quote_items(code, description, explanation");
    const { out } = await measured(U_BOSS);
    failWhen = null;
    expect(out.jobs.length).toBeGreaterThan(0);
    expect(out.jobs.every((x) => x.quoteLine === null)).toBe(true);
    const healthy = (await measured(U_BOSS)).out;
    expect(healthy.jobs.some((x) => x.quoteLine !== null)).toBe(true);
  });
});

describe("shared reads moved into an earlier round keep their answers and failure rules", () => {
  test("installStartDates gives every job the same date as installStartDate", async () => {
    failWhen = null; seed({ inHouse: true });
    tables["bookings"]!.push({ id: "bk7", job_id: j(9), business_id: B1, kind: "installation", status: "confirmed", scheduled_start: at(-5), scheduled_end: at(-5, 6) });
    tables["jobs"]!.find((x) => x["id"] === j(7))!["installation_completed_at"] = at(-20);
    const ids = [j(3), j(5), j(7), j(9), j(1)];
    const batch = await installStartDates(ids);
    for (const id of ids) expect(batch.get(id)).toBe(await installStartDate(id));
    expect(batch.get(j(7))).not.toBeNull();
    expect(batch.get(j(1))).toBeNull();
  });

  test("quote hold read: fails the read only when an unsent Ready Check quote needs it", async () => {
    seed({ inHouse: false });
    failWhen = (t, s) => t === "workflow_events" && s === "job_id, details";
    await expect(loadInstallerQuotes([j(8)])).rejects.toThrow("Quote hold could not be checked.");
    const fine = await loadInstallerQuotes([j(1), j(3)]);
    expect([...fine.values()].every((q) => !q.applies)).toBe(true);
    failWhen = null;
    expect((await loadInstallerQuotes([j(8)])).get(j(8))?.held).toBe(true);
  });

  test("safety-check payee choices: a failed read fails only when a job needs it", async () => {
    seed({ inHouse: true });
    failWhen = (t, s) => t === "workflow_events" && s.startsWith("job_id, details, created_at");
    await expect(safetyCheckPayeesFor([{ id: j(5), originating_installer_business_id: B1 }])).rejects.toThrow("Could not read the Ready Check electrician choices");
    expect((await safetyCheckPayeesFor([{ id: j(3), originating_installer_business_id: B2 }])).get(j(3))).toBeNull();
    failWhen = null;
    expect((await safetyCheckPayeesFor([{ id: j(5), originating_installer_business_id: B1 }])).get(j(5))?.piesaIncGst).toBe(330);
  });
});
