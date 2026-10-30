// Installer screens speed, Task 6: the installer job page loaders (`tradeJobPage`, the one-call `tradeJobBundle`, and
// `tradeMittiInvited` behind `getMyMittiInvited`) read in few sequential rounds, return the same value as before (owner
// and staff), keep the TEST/real rule, and keep their failure rules (money and in-house reads fail the loader where they
// do today; display-only reads keep their catch). REAL server modules against an in-memory database
// (tests/helpers/memory-postgrest.ts). Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};

// ---- Round counter: every read waits for the next timer tick; reads issued before that tick share a round. ----
let wave = 0;
let log: { table: string; sel: string; wave: number; where: string }[] = [];
let pending: (() => void)[] = [];
let scheduled = false;
let failWhen: ((table: string, sel: string) => boolean) | null = null;
const DEBUG = !!process.env["ROUNDS_DEBUG"];
function flush() { scheduled = false; wave++; const p = pending; pending = []; for (const f of p) f(); }
function where() {
  if (!DEBUG) return "";
  return (new Error().stack ?? "").split("\n").filter((l) => l.includes("/src/lib/")).slice(0, 3).map((l) => l.trim().replace(/^at /, "").replace(/\(.*\/src\/lib\//, "(").replace(/:\d+\)$/, ")")).join(" < ");
}
function later<T>(table: string, sel: string, run: () => Promise<T> | T, failed: T, at = where()): Promise<T> {
  return new Promise((resolve) => {
    log.push({ table, sel, wave, where: at });
    const fail = failWhen?.(table, sel) ?? false;
    pending.push(() => resolve(fail ? failed : run()));
    if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
  });
}
function from(table: string) {
  const q = memoryPostgrest(tables).from(table);
  const at = where();
  let sel = "*";
  const select = q.select;
  q.select = (c?: string, o?: unknown) => { sel = c ?? "*"; return select(c, o); };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => later(table, sel, () => q.run(), { data: null, error: { message: "read failed" } }, at).then(res, rej);
  return q;
}
const adminRpc: Record<string, unknown> = { has_contact_release: true };
const rpc = (answers: Record<string, unknown>) => (name: string) => later(`rpc:${name}`, "", () => ({ data: answers[name] ?? null, error: null }), { data: null, error: { message: "read failed" } });
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: rpc(adminRpc), storage: { from: () => ({}) } } }));

const { tradeJobPage, tradeMittiInvited, requireTradeJob } = await import("../src/lib/trade-view.server");
const { tradeJobBundle } = await import("../src/lib/trade-job-bundle.server");

// The signed-in person's own client (RLS): the auth read and the role functions are reads too, so they count.
function userClient(role: string) {
  const answers: Record<string, unknown> = { my_job_role: role, can_access_job: true, has_role: true, is_admin: false };
  return { from, rpc: rpc(answers), auth: { getUser: () => later("auth:getUser", "", () => ({ data: { user: { user_metadata: {} } }, error: null }), { data: { user: null }, error: null }) } } as never;
}

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
const U_BOSS = "00000000-0000-4000-8000-0000000000a1", U_STAFF = "00000000-0000-4000-8000-0000000000a2", U_ELEC = "00000000-0000-4000-8000-0000000000a3";
const J1 = "00000000-0000-4000-8000-000000000001", J2 = "00000000-0000-4000-8000-000000000002";
const at = (days: number, hour = 0) => new Date(NOW.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();

/** J1: a booked install on the installer's own job (A1), PIESA passed and cleared, Ready Check done. J2: a second job
 *  (the other source): in normal mode J2 is qa_test; in TEST mode J1 is the qa_test one and J2 is real. */
function seed(opts: { test?: boolean; inHouse?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  const src = (id: string) => (opts.test ? (id === J1 ? "qa_test" : "website") : id === J1 ? "website" : "qa_test");
  const job = (id: string, n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id, job_number: `HV-${1000 + n}`, stage, source: src(id), channel: "installer_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null,
    originating_installer_business_id: B1, installation_completed_at: null, cancelled_reason: null, ...extra,
  });
  const overview = (id: string, n: number, stage: string) => ({ id, job_number: `HV-${1000 + n}`, stage, channel: "installer_sourced", property_id: `p${n}`, owner_name: `Owner ${n}`, owner_phone: "0400000000", owner_email: `o${n}@example.com`, property_address: `${n} Test St, Geelong 3220`, source: src(id) });
  Object.assign(tables, {
    businesses: [
      { id: B1, name: "Inst Co", legal_name: "Inst Co Pty Ltd", trading_name: null, business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: true, in_house: opts.inHouse === true, pays_own_electricians: opts.inHouse === true },
      { id: B2, name: "Sparky Co", legal_name: "Sparky Pty Ltd", trading_name: "Sparky", business_type: "rec", capabilities: ["electrician"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: false, in_house: false, pays_own_electricians: false },
    ],
    business_members: [
      { id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true },
      { id: "m2", business_id: B1, user_id: U_STAFF, member_role: "member", active: true },
      { id: "m3", business_id: B2, user_id: U_ELEC, member_role: "business_admin", active: true },
    ],
    user_roles: [{ user_id: U_BOSS, role: "installer" }, { user_id: U_STAFF, role: "installer" }, { user_id: U_ELEC, role: "electrician" }],
    profiles: [
      { id: U_BOSS, full_name: "Bea Boss", phone: null, email: "bea@example.com", business_id: B1 },
      { id: U_STAFF, full_name: "Sam Staff", phone: null, email: "sam@example.com", business_id: B1 },
      { id: U_ELEC, full_name: "Eli Spark", phone: null, email: "eli@example.com", business_id: B2 },
    ],
    owners: [{ id: "o1", full_name: "Owner One" }, { id: "o2", full_name: "Owner Two" }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Geelong", postcode: "3220" }, { id: "p2", address_line: "2 Test St", suburb: "Geelong", postcode: "3220" }],
    jobs: [job(J1, 1, "installation_booked"), job(J2, 2, "installation_booked")],
    job_overview: [overview(J1, 1, "installation_booked"), overview(J2, 2, "installation_booked")],
    job_assignments: [J1, J2].flatMap((id, i) => [
      { id: `a${i}`, job_id: id, business_id: B1, user_id: U_STAFF, role: "installer", active: true },
      { id: `e${i}`, job_id: id, business_id: B2, user_id: U_ELEC, role: "electrician", active: true },
    ]),
    bookings: [J1, J2].flatMap((id, i) => [
      { id: `rc${i}`, job_id: id, business_id: B1, kind: "ready_check", status: "completed", scheduled_start: at(-20), scheduled_end: at(-20, 1), created_at: at(-22) },
      { id: `as${i}`, job_id: id, business_id: B2, kind: "assessment", status: "completed", scheduled_start: at(-10), scheduled_end: at(-10, 1), created_at: at(-12) },
      { id: `in${i}`, job_id: id, business_id: B1, kind: "installation", status: "confirmed", scheduled_start: at(3), scheduled_end: at(3, 6), created_at: at(-2) },
    ]),
    assessments: [J1, J2].map((id, i) => ({ id: `asm${i}`, job_id: id, status: "complete", piesa_outcome: "pass", completed_at: at(-10), mitti_raw_snapshot: [], downlights_qty: 4, created_at: at(-10), external_mitti_id: `m${i}` })),
    piesa_records: [J1, J2].map((id, i) => ({ id: `pr${i}`, job_id: id, kind: "initial", outcome: "pass", completed_date: "2026-10-19", signed_off_by: U_ELEC, is_current: true, created_at: at(-10), external_mitti_id: `m${i}` })),
    ceiling_measurements: [J1, J2].map((id, i) => ({ id: `cm${i}`, job_id: id, is_current: true, measured_area_m2: 92, removal_m2: null, removal_required: false, external_source: "mitti", external_id: `audit-${i}`, insulation_present: false, existing_r_value: null, zones: [] })),
    quotes: [J1, J2].map((id, i) => ({ id: `q${i}`, job_id: id, kind: "installation", status: "accepted", sent_at: at(-9), accepted_at: at(-8), release_state: "released", release_hold_reason: null, option_code: "A1", created_at: at(-9), subtotal_inc_gst: 4000, veec_discount_inc_gst: 500, customer_total_inc_gst: 3500 })),
    quote_items: [J1, J2].map((_, i) => ({ id: `qi${i}`, quote_id: `q${i}`, code: "INSUL", description: "Ceiling batts", explanation: null, quantity: 92, unit: "m2", unit_price_inc_gst: 38, line_total_inc_gst: 3500, sort: 1 })),
    quote_internals: [J1, J2].map((_, i) => ({ id: `qn${i}`, quote_id: `q${i}`, cost_ex_gst: 2000 })),
    invoices: [J1, J2].map((id, i) => ({ id: `inv${i}`, job_id: id, kind: "installation", status: "partially_paid", deposit_paid_at: at(-8), balance_paid_at: null, paid_at: null, total_paid: 349, deposit_paid_amount: 349, deposit_amount: 349, created_at: at(-9), updated_at: at(-8) })),
    owner_esc_consents: [J1, J2].map((id, i) => ({ id: `oc${i}`, job_id: id, status: "signed", owner_signed_at: at(-3), created_at: at(-4) })),
    workflow_events: [J1, J2].flatMap((id, i) => [
      { id: `w1${i}`, job_id: id, event_type: "ready_check_basics", created_at: at(-19), details: { completed: true, answered: true, missing: [], stops: [] } },
      { id: `w2${i}`, job_id: id, event_type: "visit_allocated", created_at: at(-2), details: { visit: "install", worker_name: "Sam Staff" } },
      { id: `w3${i}`, job_id: id, event_type: "mitti_piisa_audit_created", created_at: at(-2), details: { audit_id: `piisa-${i}` } },
      { id: `w4${i}`, job_id: id, event_type: "mitti_electrician_recorded", created_at: at(-19), details: { choice: "usual", name: "Eli Spark", licence: "REC 123" } },
      { id: `w5${i}`, job_id: id, event_type: "installer_price_set", created_at: at(-15), details: { price_inc_gst: 3500, inclusions: "Batts", entered_by: U_BOSS } },
      { id: `w6${i}`, job_id: id, event_type: "stage_changed", to_stage: "installation_booked", created_at: at(-2), details: {} },
    ]),
    partner_workers: [{ id: "pw1", business_id: B1, profile_id: U_STAFF, full_legal_name: "Sam Staff", trade_role: "installer", removed_at: null, approval_status: "approved", created_at: at(-60) }],
    workflow_settings: [{ id: 1, mitti_ready_check_priced_template_id: "tmpl-1", due_trade_reply_warn_hours: 24, due_trade_reply_exception_hours: 48, due_owner_reminder_days: 3, due_owner_flag_days: 7 }],
    rectification_items: [], customer_assignments: [], installer_declarations: [], appointment_proposals: [], partner_offers: [],
    rate_cards: [{ id: "rc1", business_id: B1, version: 2, effective_from: "2026-01-01", is_active: true }],
    rate_card_items: [{ id: "rci1", rate_card_id: "rc1", code: "PIESA", unit_price_ex_gst: 300 }],
    electrician_rates: [{ id: "er1", business_id: B2, service_type: "piesa", status: "active", rate_inc_gst: 330, effective_from: "2026-01-01" }],
  });
}

const access = (userId: string, jobId: string) => requireTradeJob(userId, jobId);

beforeAll(async () => {
  setSystemTime(NOW);
  seed();
  // Warm the module cache so later rounds count reads, not first module loads.
  await tradeJobBundle(userClient("installer"), U_BOSS, J1);
  await tradeMittiInvited(U_BOSS);
});
afterAll(() => { setSystemTime(); });

describe("parity: same value as before, field for field", () => {
  test("tradeJobPage, tradeJobBundle and tradeMittiInvited for owner and staff (normal, in-house and TEST)", async () => {
    failWhen = null;
    const out: Record<string, unknown> = {};
    for (const mode of [{}, { inHouse: true }, { test: true }] as const) {
      seed(mode);
      const tag = JSON.stringify(mode);
      for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF]] as const) {
        out[`page ${who} ${tag}`] = await tradeJobPage(J1, u, await access(u, J1));
        out[`bundle ${who} ${tag}`] = await tradeJobBundle(userClient("installer"), u, J1);
        out[`mitti ${who} ${tag}`] = await tradeMittiInvited(u);
      }
    }
    seed();
    out["bundle electrician"] = await tradeJobBundle(userClient("electrician"), U_ELEC, J1);
    out["mitti electrician"] = await tradeMittiInvited(U_ELEC);
    expect(out).toMatchSnapshot();
  });
});

// The brief's target is at most 2 rounds per loader. Code alone reaches 4 for the job page facts and 5 for the one-call
// bundle (from 16 and 23): the page's last round is gated reads kept behind their gate (the owner's side only once the
// install booking is read, decision 251; the PIESA owner confirmation and the electrician-at-start line only once clearance
// is known, decisions 296/327; the confirmation then reads the electrician, their profile and their business in turn),
// and the bundle adds the trade access check (1) and the safety plan's crew chain (crew →
// staff → certifications). Two rounds needs a read-only database function returning the screen's rows in one call —
// deferred (controller ruling: a live change for Jo, held until the live timing shows it is needed).
describe("rounds", () => {
  for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF]] as const) {
    test(`tradeJobPage (${who}, checked context handed in): at most 4 sequential rounds (was 16)`, async () => {
      failWhen = null; seed();
      const pre = await access(u, J1);
      const r = await measured(() => tradeJobPage(J1, u, pre));
      if (r.rounds > 4) console.log(`tradeJobPage ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(4);
    });
    test(`tradeJobBundle (${who}): at most 5 sequential rounds (was 23)`, async () => {
      failWhen = null; seed();
      const r = await measured(() => tradeJobBundle(userClient("installer"), u, J1));
      if (r.rounds > 5) console.log(`tradeJobBundle ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(5);
    });
  }
  for (const mode of [{ inHouse: true }, { test: true }] as const) {
    test(`in-house / TEST businesses read in the same rounds (${JSON.stringify(mode)})`, async () => {
      failWhen = null; seed(mode);
      const page = await measured(async () => tradeJobPage(J1, U_BOSS, await requireTradeJob(U_BOSS, J1)));
      expect(page.rounds).toBeLessThanOrEqual(5); // + the access check measured with it
      const b = await measured(() => tradeJobBundle(userClient("installer"), U_BOSS, J1));
      expect(b.rounds).toBeLessThanOrEqual(5);
    });
  }
  test("an unsent quote (its hold check) and a not-yet-booked install stay inside the same rounds", async () => {
    failWhen = null; seed();
    for (const q of tables["quotes"]!) { q["status"] = "draft"; q["sent_at"] = null; q["accepted_at"] = null; }
    for (const b of tables["bookings"]!) if (b["kind"] === "installation") b["status"] = "cancelled";
    const r = await measured(async () => tradeJobPage(J1, U_BOSS, await requireTradeJob(U_BOSS, J1)));
    expect(r.out.quote?.sent).toBe(false);
    expect(r.out.install.ownerReady).toBeNull();
    expect(r.rounds).toBeLessThanOrEqual(5); // + the access check
    expect((await measured(() => tradeJobBundle(userClient("installer"), U_STAFF, J1))).rounds).toBeLessThanOrEqual(5);
    // Known follow-up: the business owner's own unsent quote card also runs the office quote-readiness checks
    // (officeQuoteBlockers: intake, billing and product chains), which this task does not flatten — 8 rounds today.
    await tradeJobBundle(userClient("installer"), U_BOSS, J1); // load the office-review modules first (a module load is not a read)
    expect((await measured(() => tradeJobBundle(userClient("installer"), U_BOSS, J1))).rounds).toBeLessThanOrEqual(8);
  });
  test("the trade access check is one round (context and assignments together)", async () => {
    failWhen = null; seed();
    expect((await measured(() => requireTradeJob(U_STAFF, J1))).rounds).toBe(1);
  });
  test("tradeMittiInvited: one round", async () => {
    failWhen = null; seed();
    const r = await measured(() => tradeMittiInvited(U_STAFF));
    expect(r.out.invited).toBe(true);
    expect(r.rounds).toBe(1);
  });
});

/** Both installs done (completed install bookings), so the owner's pay row exists for each job. */
function seedDone(opts: { test?: boolean } = {}) {
  seed(opts);
  for (const b of tables["bookings"]!) if (b["kind"] === "installation") { b["status"] = "completed"; b["scheduled_start"] = at(-1); }
  for (const j of tables["jobs"]!) { j["stage"] = "evidence_outstanding"; j["installation_completed_at"] = at(-1); }
  for (const j of tables["job_overview"]!) j["stage"] = "evidence_outstanding";
}

describe("TEST and real jobs never mix", () => {
  test("TEST business: the owner's pay line shows on the qa_test job, never on the real one", async () => {
    failWhen = null; seedDone({ test: true }); // TEST mode: J1 is qa_test, J2 is real
    const testJob = await tradeJobPage(J1, U_BOSS, await access(U_BOSS, J1));
    const realJob = await tradeJobPage(J2, U_BOSS, await access(U_BOSS, J2));
    expect(testJob.complete.pay).not.toBeNull();
    expect(realJob.complete.pay).toBeNull();
  });
  test("ordinary business: both jobs carry their own pay line", async () => {
    failWhen = null; seedDone(); // J1 real, J2 qa_test; a real business is not filtered
    expect((await tradeJobPage(J1, U_BOSS, await access(U_BOSS, J1))).complete.pay).not.toBeNull();
    expect((await tradeJobPage(J2, U_BOSS, await access(U_BOSS, J2))).complete.pay).not.toBeNull();
  });
});

describe("failure rules unchanged", () => {
  test("a failed money read (payout gate) fails the owner's job page, and the bundle shows that section as an error", async () => {
    seedDone();
    failWhen = (t) => t === "installer_declarations";
    await expect(tradeJobPage(J1, U_BOSS, await access(U_BOSS, J1))).rejects.toThrow("Could not read installer_declarations");
    const b = await tradeJobBundle(userClient("installer"), U_BOSS, J1);
    failWhen = null;
    expect(b.page).toEqual({ error: "Could not read installer_declarations for the payout check: read failed" } as never);
    expect((b.overview as { id?: string }).id).toBe(J1);
  });
  test("staff never read owner money: the same failing read leaves the staff page whole", async () => {
    seedDone();
    failWhen = (t) => t === "installer_declarations";
    const page = await tradeJobPage(J1, U_STAFF, await access(U_STAFF, J1));
    failWhen = null;
    expect(page.complete.pay).toBeNull();
    expect(page.pay.amount).toBeNull();
  });
  test("a failed quote read fails the job page, as today", async () => {
    seed();
    failWhen = (t, s) => t === "quotes" && s.includes("quote_items");
    await expect(tradeJobPage(J1, U_STAFF, await access(U_STAFF, J1))).rejects.toThrow("Quote could not be read.");
    failWhen = null;
  });
  test("a failed in-house read never fails the page: the overview reports it and the page still loads", async () => {
    seed({ inHouse: true });
    failWhen = (t, s) => t === "job_assignments" && s.includes("in_house");
    const b = await tradeJobBundle(userClient("installer"), U_STAFF, J1);
    failWhen = null;
    expect((b.overview as { inHouseDispatch?: unknown }).inHouseDispatch).toBe("in_house_read_failed");
    expect((b.page as { jobNumber?: string }).jobNumber).toBe("HV-1001");
  });
  test("display-only reads keep their catch: failed owner-side, PIESA-confirm and attendance reads blank only their line", async () => {
    seed();
    const healthy = await tradeJobPage(J1, U_BOSS, await access(U_BOSS, J1));
    expect(healthy.install.ownerReady).not.toBeNull();
    failWhen = (t) => t === "owner_esc_consents" || t === "official_form_signed_copies" || t === "piesa_records";
    const page = await tradeJobPage(J1, U_BOSS, await access(U_BOSS, J1));
    failWhen = null;
    expect(page.jobNumber).toBe("HV-1001");
    expect(page.ownerPiesaConfirmed).toBeNull();
  });
  test("a refused trade (not assigned) gets the refusal in every trade section", async () => {
    seed();
    tables["job_assignments"] = tables["job_assignments"]!.filter((a) => !(a["job_id"] === J1 && a["role"] === "installer"));
    await expect(requireTradeJob(U_STAFF, J1)).rejects.toThrow("This job isn't assigned to you.");
    const b = await tradeJobBundle(userClient("installer"), U_STAFF, J1);
    expect(b.page).toEqual({ error: "This job isn't assigned to you." } as never);
    expect(b.mittiInvited).toEqual({ error: "This job isn't assigned to you." } as never);
  });
  test("no business: the sign-in refusal wins over the assignment check", async () => {
    seed();
    tables["business_members"] = tables["business_members"]!.filter((m) => m["user_id"] !== U_STAFF);
    await expect(requireTradeJob(U_STAFF, J1)).rejects.toThrow("Your sign-in isn't linked to an approved business yet.");
  });
});
