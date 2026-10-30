// Installer screens speed, Task 7: the install day / Ready Check day screen loaders (`tradeDay` behind getTradeDayView —
// the one call the day page waits for before its first draw — `tradeDayExtras` behind getTradeDayExtras, and
// `onsiteFormFor` behind onsiteFormStatus) read in few sequential rounds, return the same value as before (owner, staff
// and electrician), keep the TEST/real rule and keep their failure rules (in-house and membership reads fail the loader
// where they do today; display-only reads keep their catch). REAL server modules against an in-memory database
// (tests/helpers/memory-postgrest.ts). Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};

// ---- Round counter: every read waits for the next timer tick; reads issued before that tick share a round. ----
let wave = 0;
let log: { table: string; sel: string; wave: number; where: string }[] = [];
let pending: (() => void)[] = [];
let scheduled = false;
/** `info` = the query's filters as text (e.g. `contains details {"rectification_round":"m3"}`), so one read can be failed. */
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

const { tradeDay, tradeDayExtras, requireTradeJob } = await import("../src/lib/trade-view.server");
const { onsiteFormFor } = await import("../src/lib/onsite-ready-check.server");

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
/** J1: install day (booked install, PIESA passed, Ready Check done). J2: Ready Check day (Ready Check booked, nothing
 *  measured yet). J3: the electrician's fixes day (PIESA failed, fixes booked). */
const J1 = "00000000-0000-4000-8000-000000000001", J2 = "00000000-0000-4000-8000-000000000002", J3 = "00000000-0000-4000-8000-000000000003";
/** The database's rows (a read of an unknown table only adds an empty list in the fake, never a row). */
const rowsOf = (t: Tables) => JSON.stringify(Object.fromEntries(Object.entries(t).filter(([, v]) => v.length)));
const at = (days: number, hour = 0) => new Date(NOW.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();

/** In normal mode J2 is the qa_test job; in TEST mode J1 is the qa_test one and J2 is real. */
function seed(opts: { test?: boolean; inHouse?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  const src = (id: string) => (opts.test ? (id === J1 ? "qa_test" : "website") : id === J2 ? "qa_test" : "website");
  const job = (id: string, n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id, job_number: `HV-${1000 + n}`, stage, source: src(id), channel: "installer_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, eligibility_outcome: "appears_eligible",
    originating_installer_business_id: B1, installation_completed_at: null, estimated_area_m2: 90 + n, estimated_area_unknown: false, life_support_status: "no", ...extra,
  });
  const ids = [J1, J2, J3];
  Object.assign(tables, {
    businesses: [
      { id: B1, name: "Inst Co", business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: true, in_house: opts.inHouse === true },
      { id: B2, name: "Sparky Co", business_type: "rec", capabilities: ["electrician"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: opts.test ? "[TEST PARTNER] practice" : null, mitti_account_invited: true, in_house: false },
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
      { id: U_ELEC, full_name: "Eli Spark", phone: "0411111111", email: "eli@example.com", business_id: B2 },
    ],
    owners: ids.map((_, i) => ({ id: `o${i + 1}`, full_name: `Owner Number${i + 1}`, phone: `040000000${i + 1}` })),
    properties: ids.map((_, i) => ({ id: `p${i + 1}`, address_line: `${i + 1} Test St`, suburb: "Geelong", postcode: "3220", year_built: 1970, enrichment: { base44: { raw: { answers: { existing_insulation: i === 0 ? "none" : "some" } } } } })),
    jobs: [job(J1, 1, "installation_booked"), job(J2, 2, "ready_check_booked"), job(J3, 3, "rectification_booked")],
    job_assignments: ids.flatMap((id, i) => [
      { id: `a${i}`, job_id: id, business_id: B1, user_id: U_STAFF, role: "installer", active: true },
      { id: `e${i}`, job_id: id, business_id: B2, user_id: U_ELEC, role: "electrician", active: true },
    ]),
    bookings: [
      { id: "rc0", job_id: J1, business_id: B1, kind: "ready_check", status: "completed", scheduled_start: at(-20), scheduled_end: at(-20, 1), created_at: at(-22) },
      { id: "as0", job_id: J1, business_id: B2, kind: "assessment", status: "completed", scheduled_start: at(-10), scheduled_end: at(-10, 1), created_at: at(-12) },
      { id: "in0", job_id: J1, business_id: B1, kind: "installation", status: "confirmed", scheduled_start: at(1), scheduled_end: at(1, 6), created_at: at(-2) },
      { id: "rc1", job_id: J2, business_id: B1, kind: "ready_check", status: "confirmed", scheduled_start: at(1), scheduled_end: at(1, 1), created_at: at(-2) },
      { id: "rc2", job_id: J3, business_id: B1, kind: "ready_check", status: "completed", scheduled_start: at(-20), scheduled_end: at(-20, 1), created_at: at(-22) },
      { id: "as2", job_id: J3, business_id: B2, kind: "assessment", status: "completed", scheduled_start: at(-10), scheduled_end: at(-10, 1), created_at: at(-12) },
      { id: "rx2", job_id: J3, business_id: B2, kind: "rectification", status: "confirmed", scheduled_start: at(1), scheduled_end: at(1, 2), created_at: at(-2) },
    ],
    assessments: [
      { id: "asm0", job_id: J1, status: "complete", piesa_outcome: "pass", hazards: null, external_mitti_id: "m1", created_at: at(-10), downlights_qty: 4 },
      { id: "asm2", job_id: J3, status: "complete", piesa_outcome: "fail", hazards: "Old wiring", external_mitti_id: "m3", created_at: at(-10), downlights_qty: 2 },
    ],
    ready_checks: [{ id: "rk0", job_id: J1, status: "submitted", submitted_at: at(-19), external_mitti_id: "rcm1", created_at: at(-20) }],
    ceiling_measurements: [{ id: "cm0", job_id: J1, is_current: true, measured_area_m2: 92, removal_m2: 10, removal_required: true, access_difficulty: "tight", external_source: "mitti", external_id: "audit-1", status: "complete", raw_snapshot: [] }],
    evidence_requirements: [{ id: "ev0", job_id: J1, label: "Ceiling photo", category: "photo", gate: "install", required: true, status: "outstanding" }],
    rectification_items: [{ id: "ri0", job_id: J3, description: "Replace junction box", status: "open" }],
    quotes: [J1, J2].map((id, i) => ({ id: `q${i}`, job_id: id, kind: "installation", status: "accepted", created_at: at(-9) })),
    quote_items: [J1, J2].flatMap((_, i) => [
      { id: `qi${i}`, quote_id: `q${i}`, code: "INSUL", description: "Ceiling batts R4.0", sort: 1 },
      { id: `qp${i}`, quote_id: `q${i}`, code: "PIESA", description: "Electrical safety assessment", sort: 0 },
    ]),
    quote_internals: [J1, J2].map((_, i) => ({ id: `qn${i}`, quote_id: `q${i}`, cost_ex_gst: 2000 })),
    customer_assignments: [{ id: "ca0", job_id: J1, record_kind: "final_veec_assignment", status: "draft", installer_signed_at: at(-1), created_at: at(-2) }],
    installer_declarations: [],
    job_piesa_deadlines: [{ id: "dl0", job_id: J1, install_deadline: "2026-11-20" }],
    official_form_signed_copies: [],
    workflow_events: [
      { id: "w1", job_id: J1, event_type: "visit_allocated", created_at: at(-2), details: { visit: "install", worker_name: "Sam Staff" } },
      { id: "w2", job_id: J1, event_type: "mitti_piisa_audit_created", created_at: at(-2), details: { audit_id: "piisa-1" } },
      { id: "w3", job_id: J1, event_type: "piisa_crew_selected", created_at: at(-2), details: { selection: { lead: { workerId: "pw1" }, additional: [] } } },
      { id: "w4", job_id: J1, event_type: "install_evidence_synced", created_at: at(-1), details: { summary: { blockers: [] } } },
      { id: "w5", job_id: J3, event_type: "fixes_form_created", created_at: at(-1), details: { audit_id: "fx-3", rectification_round: "m3" } },
      { id: "w6", job_id: J2, event_type: "mitti_access_needed", created_at: at(-1), summary: "Mitti login needed", details: {} },
    ],
    partner_workers: [{ id: "pw1", business_id: B1, profile_id: U_STAFF, email: "sam@example.com", full_legal_name: "Sam Staff", certification: null, trade_role: "installer", worker_role: "installer", removed_at: null, approval_status: "approved", licence_expires_on: null, declarations_due: false, created_at: at(-60) }],
    workflow_settings: [{ id: 1, mitti_ready_check_priced_template_id: "tmpl-1", auto_send_mitti: true, mitti_fixes_template_id: "fx-tmpl" }],
  });
}

beforeAll(async () => {
  setSystemTime(NOW);
  seed();
  // Warm the module cache so the rounds count reads, not first module loads.
  for (const [u, j] of [[U_BOSS, J1], [U_BOSS, J2], [U_ELEC, J3], [U_ELEC, J1]] as const) { await tradeDay(j, u); await tradeDayExtras(j, u); }
  await onsiteFormFor(J2, U_BOSS);
});
afterAll(() => { setSystemTime(); });

async function all(mode: { test?: boolean; inHouse?: boolean }) {
  seed(mode);
  const out: Record<string, unknown> = {};
  for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF]] as const) {
    for (const j of [J1, J2]) {
      out[`day ${who} ${j.slice(-1)}`] = await tradeDay(j, u);
      out[`extras ${who} ${j.slice(-1)}`] = await tradeDayExtras(j, u);
      out[`onsite ${who} ${j.slice(-1)}`] = await onsiteFormFor(j, u);
    }
  }
  for (const j of [J1, J3]) {
    out[`day electrician ${j.slice(-1)}`] = await tradeDay(j, U_ELEC);
    out[`extras electrician ${j.slice(-1)}`] = await tradeDayExtras(j, U_ELEC);
  }
  return out;
}

describe("parity: same value as before, field for field", () => {
  test("tradeDay, tradeDayExtras and onsiteFormFor for owner, staff and electrician (normal, in-house and TEST)", async () => {
    failWhen = null;
    const out: Record<string, unknown> = {};
    for (const mode of [{}, { inHouse: true }, { test: true }] as const) out[JSON.stringify(mode)] = await all(mode);
    expect(out).toMatchSnapshot();
  });
});

// The day page draws once tradeDay answers (getTradeDayView); extras and the Ready Check form status load beside it.
describe("rounds", () => {
  for (const [who, u] of [["owner", U_BOSS], ["staff", U_STAFF]] as const) {
    test(`tradeDay install day (${who}): at most 2 sequential rounds (was 3)`, async () => {
      failWhen = null; seed();
      const r = await measured(() => tradeDay(J1, u));
      expect(r.out.kind).toBe("install");
      if (r.rounds > 2) console.log(`tradeDay ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(2);
    });
    test(`tradeDay Ready Check day (${who}): at most 2 sequential rounds`, async () => {
      failWhen = null; seed();
      const r = await measured(() => tradeDay(J2, u));
      expect(r.out.kind).toBe("ready_check");
      expect(r.rounds).toBeLessThanOrEqual(2);
    });
    test(`tradeDayExtras (${who}): at most 2 sequential rounds (was 6)`, async () => {
      failWhen = null; seed();
      const r = await measured(() => tradeDayExtras(J1, u));
      if (r.rounds > 2) console.log(`tradeDayExtras ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(2);
    });
    test(`onsiteFormFor (${who}): at most 2 sequential rounds (was 3)`, async () => {
      failWhen = null; seed();
      const r = await measured(() => onsiteFormFor(J2, u));
      if (r.rounds > 2) console.log(`onsiteFormFor ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(2);
    });
  }
  // The electrician's fixes form waits for the day kind (bookings), so an electrician's fixes day is one round more than the
  // installer's day: the access check stays first (decision 280's one access check), and the form chain is not read speculatively.
  test("electrician's fixes day (no companion-round history): at most 3 sequential rounds (was 5)", async () => {
    failWhen = null; seed();
    tables["workflow_events"]!.find((e) => e["id"] === "w5")!["details"] = { audit_id: "fx-3" };
    const r = await measured(() => tradeDay(J3, U_ELEC));
    expect(r.out.kind).toBe("fixes");
    if (r.rounds > 3) console.log(`tradeDay fixes rounds = ${r.rounds}\n${roundsOf(r.log)}`);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });
  // Known limit: with companion-round history the in-house dispatch read is only made once that history is read (its own
  // rule: "do not consult dispatch at all without any companion-round history"), then a held job reads its round in turn.
  test("electrician's fixes day with companion-round history: 4 rounds (was 6); held in-house: at most 8 (was 10)", async () => {
    failWhen = null; seed();
    const r = await measured(() => tradeDay(J3, U_ELEC));
    if (DEBUG) console.log(roundsOf(r.log));
    expect(r.rounds).toBeLessThanOrEqual(4);
    seed({ inHouse: true });
    const h = await measured(() => tradeDay(J3, U_ELEC));
    if (DEBUG) console.log(roundsOf(h.log));
    expect(h.rounds).toBeLessThanOrEqual(8);
  });
});

describe("TEST and real jobs never mix", () => {
  // The day loaders are per job and have no TEST filter of their own: a TEST business sees its qa_test job's day and a
  // real job's day exactly as before (parity snapshot), and the TEST label comes only from the same business read.
  test("TEST business: the qa_test job's day carries its own facts; the real job's day is not mixed in", async () => {
    failWhen = null; seed({ test: true }); // J1 qa_test, J2 real
    const testDay = await tradeDay(J1, U_BOSS);
    const realDay = await tradeDay(J2, U_BOSS);
    expect(testDay.jobNumber).toBe("HV-1001");
    expect(realDay.jobNumber).toBe("HV-1002");
    expect(testDay.kind).toBe("install");
    expect(realDay.kind).toBe("ready_check");
    const testX = await tradeDayExtras(J1, U_BOSS);
    const realX = await tradeDayExtras(J2, U_BOSS);
    expect(testX.installDeadline).toBe("2026-11-20");
    expect(realX.installDeadline).toBeNull();
  });
});

describe("failure rules unchanged", () => {
  test("a failed in-house rectification-round read fails the fixes day, as today", async () => {
    seed({ inHouse: true });
    failWhen = (t, _s, info) => t === "workflow_events" && info.includes("contains details {\"rectification_round\"");
    await expect(tradeDay(J3, U_ELEC)).rejects.toThrow("read failed");
    failWhen = null;
  });
  test("a failed in-house dispatch read never fails the fixes day (logged; the form id comes from the events)", async () => {
    seed({ inHouse: true });
    failWhen = (t, s) => t === "job_assignments" && s.includes("businesses(in_house)");
    const d = await tradeDay(J3, U_ELEC);
    failWhen = null;
    expect(d.kind).toBe("fixes");
    expect(d.mittiId).toBe("fx-3");
  });
  test("a failed membership read fails the Ready Check form status, as today", async () => {
    seed();
    failWhen = (t, s) => t === "business_members" && s === "business_id, member_role";
    await expect(onsiteFormFor(J2, U_STAFF)).rejects.toThrow("Could not read active business memberships");
    failWhen = null;
  });
  test("a job that isn't an installer customer is refused before membership, and nothing is written", async () => {
    seed();
    tables["jobs"]!.find((j) => j["id"] === J2)!["channel"] = "website";
    const before = rowsOf(tables);
    await expect(onsiteFormFor(J2, U_STAFF)).rejects.toThrow("This job isn't one of your customers.");
    expect(rowsOf(tables)).toBe(before);
  });
  test("display-only reads keep their catch: safety plan, PIESA copy, pay and owner-answer reads blank only their line", async () => {
    seed();
    failWhen = (t) => t === "official_form_signed_copies" || t === "partner_workers" || t === "quote_internals" || (t === "jobs");
    // jobs fails everywhere (the day's own row too): today's extras still answers with blanks.
    const x = await tradeDayExtras(J1, U_STAFF).catch((e: Error) => e.message);
    failWhen = (t, s) => t === "official_form_signed_copies" || (t === "quotes" && s.includes("quote_internals")) || t === "partner_workers";
    const y = await tradeDayExtras(J1, U_BOSS);
    failWhen = null;
    expect(typeof x === "string" ? x : "answered").toBe("answered");
    expect(y.electrician.required).toBe(false);
    expect(y.pay).toBeNull();
    expect(y.installForm.swmsComplete).toBe(false);
  });
  test("a refused trade (not assigned) is refused by both day loaders, and nothing is written", async () => {
    seed();
    tables["job_assignments"] = tables["job_assignments"]!.filter((a) => !(a["job_id"] === J1 && a["role"] === "installer"));
    const before = rowsOf(tables);
    await expect(tradeDay(J1, U_STAFF)).rejects.toThrow("This job isn't assigned to you.");
    await expect(tradeDayExtras(J1, U_STAFF)).rejects.toThrow("This job isn't assigned to you.");
    expect(rowsOf(tables)).toBe(before);
  });
  test("no business: the sign-in refusal wins over the assignment check on both day loaders", async () => {
    seed();
    tables["business_members"] = tables["business_members"]!.filter((m) => m["user_id"] !== U_STAFF);
    await expect(tradeDay(J1, U_STAFF)).rejects.toThrow("Your sign-in isn't linked to an approved business yet.");
    await expect(tradeDayExtras(J1, U_STAFF)).rejects.toThrow("Your sign-in isn't linked to an approved business yet.");
    expect((await requireTradeJob(U_BOSS, J1)).boss).toBe(true);
  });
});
