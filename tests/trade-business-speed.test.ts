// Installer screens speed, Task 9: the business pages' loaders — `tradeBusiness` (getTradeBusiness: /field/business and
// /field/business/team) and `tradeBusinessFile` (getTradeBusinessFile: /field/business/details and /rates) — read in few
// sequential rounds, return the same value as before field for field (installer and electrician; owner and staff; normal and
// TEST; with display reads failing), keep staff refused before any owner-only data (rates, bank, team details) is read, and
// keep their failure rules (the usual-electrician read fails the loader as today; the team display reads keep their catch).
// REAL server modules against an in-memory database (tests/helpers/memory-postgrest.ts). Run on its own (bun shares
// mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { COLLECTION_NOTICE_SHA256 } from "../src/lib/esc-collection-notice.core";

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
  // `details->>worker_id` filters (JSON text paths) are applied here, after the helper's own filters.
  const jsonIn: { col: string; key: string; vals: unknown[] }[] = [];
  const select = q.select;
  q.select = (c?: string, o?: unknown) => { sel = c ?? "*"; return select(c, o); };
  for (const m of ["eq", "contains", "in"] as const) {
    const orig = q[m];
    q[m] = (c: string, v: unknown) => {
      info += ` ${m} ${c} ${JSON.stringify(v)}`;
      if (m === "in" && c.includes("->>")) { const [col, key] = c.split("->>") as [string, string]; jsonIn.push({ col, key, vals: v as unknown[] }); return q; }
      return orig(c, v);
    };
  }
  const run = q.run;
  q.run = async () => {
    const r = await run();
    if (!jsonIn.length || !Array.isArray(r.data)) return r;
    // The JSON column must be selected for the post-filter (true of every such read in these loaders).
    return { ...r, data: r.data.filter((row: Record<string, unknown>) => jsonIn.every((f) => f.vals.includes(String((row[f.col] as Record<string, unknown> | null)?.[f.key] ?? "")))) };
  };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => later(table, sel, info, () => q.run(), { data: null, count: null, error: { message: "read failed", code: "XX000" } }, at).then(res, rej);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: (name: string) => later(`rpc:${name}`, "", "", () => ({ data: null, error: null }), { data: null, error: { message: "read failed" } }), storage: { from: () => ({}) } } }));

const { tradeBusiness, tradeBusinessFile } = await import("../src/lib/trade-view.server");

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
const U_BOSS = "00000000-0000-4000-8000-0000000000a1", U_STAFF = "00000000-0000-4000-8000-0000000000a2", U_ELEC = "00000000-0000-4000-8000-0000000000a3", U_ESTAFF = "00000000-0000-4000-8000-0000000000a4", U_NONE = "00000000-0000-4000-8000-0000000000a9";
const W_BOSS = "00000000-0000-4000-8000-0000000000c1", W_STAFF = "00000000-0000-4000-8000-0000000000c2", W_NOLOGIN = "00000000-0000-4000-8000-0000000000c3", W_ELEC = "00000000-0000-4000-8000-0000000000c4", W_ESTAFF = "00000000-0000-4000-8000-0000000000c5";
const C_STAFF = "00000000-0000-4000-8000-0000000000e2", C_BOSS = "00000000-0000-4000-8000-0000000000e1";
const J1 = "00000000-0000-4000-8000-000000000001", J2 = "00000000-0000-4000-8000-000000000002";
const rowsOf = (t: Tables) => JSON.stringify(Object.fromEntries(Object.entries(t).filter(([, v]) => v.length)));
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

/** B1 installer business (owner + staff), B2 electrician business (owner + staff). `test`: both are TEST partners. One real
 *  and one qa_test job exist; the business pages read no jobs at all. */
function seed(opts: { test?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  const notes = opts.test ? "[TEST PARTNER] practice" : null;
  Object.assign(tables, {
    businesses: [
      { id: B1, name: "Inst Co", legal_name: "Inst Co Pty Ltd", trading_name: null, abn: "11 222 333 444", phone: "0390000000", email: "inst@example.com", address: "1 Base St", business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: notes, mitti_account_invited: true, approved_at: "2026-02-01T00:00:00.000Z", typical_days: ["Mon", "Tue"], lead_time: "1 week", public_liability_cover_amount: 20000000, onboarding_status: "active" },
      { id: B2, name: "Sparky Co", legal_name: null, trading_name: "Sparky", abn: null, phone: null, email: null, address: null, business_type: "rec", capabilities: ["electrician"], base_suburb: "Ballarat", coverage_radius_km: null, covers_all_victoria: true, accepting_new_jobs: false, onboarding_notes: notes, mitti_account_invited: false, approved_at: null, typical_days: null, lead_time: null, public_liability_cover_amount: "10000000", onboarding_status: "active" },
    ],
    business_members: [
      { id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true },
      { id: "m2", business_id: B1, user_id: U_STAFF, member_role: "member", active: true },
      { id: "m3", business_id: B2, user_id: U_ELEC, member_role: "business_admin", active: true },
      { id: "m4", business_id: B2, user_id: U_ESTAFF, member_role: "member", active: true },
    ],
    user_roles: [{ user_id: U_BOSS, role: "installer" }, { user_id: U_STAFF, role: "installer" }, { user_id: U_ELEC, role: "electrician" }, { user_id: U_ESTAFF, role: "electrician" }],
    profiles: [
      { id: U_BOSS, full_name: "Bea Boss", phone: "0400000001", email: "bea@example.com", mitti_user_id: "mu1", mitti_checked_email: "bea@example.com", mitti_checked_at: at(-5) },
      { id: U_STAFF, full_name: "Sam Staff", phone: "0400000002", email: "sam@example.com", mitti_user_id: "mu2", mitti_checked_email: "old@example.com", mitti_checked_at: at(-5) },
      { id: U_ELEC, full_name: "Eli Spark", phone: null, email: "eli@example.com", mitti_user_id: null, mitti_checked_email: null, mitti_checked_at: null },
      { id: U_ESTAFF, full_name: "Ed Spark", phone: null, email: "ed@example.com", mitti_user_id: null, mitti_checked_email: null, mitti_checked_at: null },
    ],
    partner_workers: [
      { id: W_BOSS, business_id: B1, full_legal_name: "Bea Boss ", trade_role: "installer", approval_status: "approved", licence_expires_on: null, profile_id: U_BOSS, email: "bea@example.com", mobile: "0411000001", certification_status: "verified", certification: { verification_id: C_BOSS }, worker_role: "lead", declarations_due: false, removed_at: null },
      { id: W_STAFF, business_id: B1, full_legal_name: "Sam Staff", trade_role: "installer", approval_status: "approved", licence_expires_on: null, profile_id: U_STAFF, email: "sam@example.com", mobile: "0411000002", certification_status: "pending", certification: { verification_id: C_STAFF }, worker_role: null, declarations_due: true, removed_at: null },
      { id: W_NOLOGIN, business_id: B1, full_legal_name: "Nat Nologin", trade_role: "installer", approval_status: "pending", licence_expires_on: null, profile_id: null, email: null, mobile: null, certification_status: null, certification: null, worker_role: "crew", removed_at: null },
      { id: "00000000-0000-4000-8000-0000000000c9", business_id: B1, full_legal_name: "Gone Person", trade_role: "installer", approval_status: "approved", licence_expires_on: null, profile_id: null, email: "gone@example.com", mobile: null, certification: null, worker_role: null, removed_at: at(-30) },
      { id: W_ELEC, business_id: B2, full_legal_name: "Eli Spark", trade_role: "electrician", approval_status: "approved", licence_expires_on: "2027-03-01", profile_id: U_ELEC, email: "eli@example.com", mobile: "0422000001", certification: null, worker_role: null, removed_at: null },
      { id: W_ESTAFF, business_id: B2, full_legal_name: "Ed Spark", trade_role: "electrician", approval_status: "approved", licence_expires_on: "2026-12-01", profile_id: U_ESTAFF, email: "ed@example.com", mobile: null, certification: null, worker_role: null, removed_at: null },
    ],
    partner_worker_certifications: [
      { id: C_BOSS, status: "verified", certificate_number: "EEC-1", issuer: "ESC", worker_id: W_BOSS },
      { id: C_STAFF, status: "rejected", certificate_number: "EEC-2", issuer: "ESC", worker_id: W_STAFF },
    ],
    worker_certification_levels: [{ id: "l1", certification_id: C_BOSS, level: "lead", expires_on: "2027-06-30", recorded_at: at(-40) }],
    admin_config_events: [
      { id: "ev1", event_type: "esc_collection_notice_acknowledged", created_at: at(-10), details: { business_id: B1, worker_id: W_BOSS, worker_email: "bea@example.com", at: at(-10), by_name: "Bea Boss", notice_version: "1", notice_sha256: COLLECTION_NOTICE_SHA256 } },
      { id: "ev2", event_type: "mitti_user_linked", created_at: at(-9), details: { worker_id: W_BOSS } },
      { id: "ev3", event_type: "mitti_invite_office_done", created_at: at(-8), details: { worker_id: W_NOLOGIN } },
      { id: "ev4", event_type: "mitti_user_linked", created_at: at(-8), details: { worker_id: "someone-else" } },
      { id: "ev5", event_type: "installer_usual_electrician_saved", created_at: at(-20), details: { business_id: B1, electrician: { name: "Old Sparky", licence: "REC 1" } } },
      { id: "ev6", event_type: "installer_usual_electrician_saved", created_at: at(-3), details: { business_id: B1, electrician: { name: "New Sparky", licence: "REC 2", priceIncGst: 330, email: "NEW@example.com" } } },
    ],
    partner_activations: [
      { id: "pa1", business_id: B1, application_id: "app1" },
      { id: "pa2", business_id: B2, application_id: "app2" },
    ],
    rec_onboarding_applications: [
      { id: "app1", data: { installers: [{ email: "sam@example.com", esc_notice_ack: { at: at(-60), by_name: "Sam Staff", notice_version: "1", notice_sha256: COLLECTION_NOTICE_SHA256 } }] } },
      { id: "app2", data: { works_under_rec: true } },
    ],
    business_credentials: [
      { id: "cr1", business_id: B1, kind: "public_liability_insurance", label: "PL insurance", number: "PL-1", issuer: "Insurer", expires_at: "2027-01-31", verification: "verified", document_path: "b1/pl.pdf", created_at: at(-50) },
      { id: "cr2", business_id: B1, kind: "public_liability_insurance", label: "PL insurance (old)", number: "PL-0", issuer: "Insurer", expires_at: "2026-01-31", verification: "pending", document_path: null, created_at: at(-400) },
      { id: "cr3", business_id: B2, kind: "electrical_licence", label: "Licence", number: "L-1", issuer: "ESV", expires_at: "2027-05-01", verification: "verified", document_path: null, created_at: at(-50) },
    ],
    partner_agreements: [
      { id: "ag1", business_id: B1, version: 2, body: "agreement", signer_name: "Bea Boss", signed_at: at(-100) },
      { id: "ag0", business_id: B1, version: 1, body: "agreement", signer_name: "Bea Boss", signed_at: at(-200) },
    ],
    business_bank_details: [{ id: "bb1", business_id: B1, account_name: "Inst Co Trading", account_number: "12345678", bsb: "063-123" }],
    rate_cards: [{ id: "rcd1", business_id: B1, name: "Standard", version: 2, effective_from: "2026-01-01", created_at: at(-300), is_active: true }],
    rate_card_items: [
      { id: "rci2", rate_card_id: "rcd1", description: "R5.0 batts", unit: "m2", display_unit: "m²", unit_price_ex_gst: 27.27, sort: 2 },
      { id: "rci1", rate_card_id: "rcd1", description: "R4.0 batts", unit: "m2", display_unit: null, unit_price_ex_gst: 22.73, sort: 1 },
    ],
    electrician_rates: [
      { id: "er1", business_id: B2, service_type: "piesa", status: "active", rate_inc_gst: 330 },
      { id: "er2", business_id: B2, service_type: "electrical_fixes", status: "active", rate_inc_gst: 120 },
    ],
    partner_change_requests: [
      { id: "pc1", business_id: B1, kind: "details", message: "New phone", status: "open", created_at: at(-2) },
      { id: "pc2", business_id: B1, kind: "rates", message: "Old", status: "closed", created_at: at(-20) },
    ],
    jobs: [
      { id: J1, job_number: "HV-1001", source: "website", stage: "installation_booked" },
      { id: J2, job_number: "HV-1002", source: "qa_test", stage: "installation_booked" },
    ],
    job_assignments: [J1, J2].map((id, i) => ({ id: `a${i}`, job_id: id, business_id: B1, user_id: U_STAFF, role: "installer", active: true })),
  });
}

const PEOPLE = [["owner", U_BOSS], ["staff", U_STAFF], ["electrician owner", U_ELEC], ["electrician staff", U_ESTAFF], ["no business", U_NONE]] as const;

beforeAll(async () => {
  setSystemTime(NOW);
  seed();
  // Warm the module cache so the rounds count reads, not first module loads.
  for (const [, u] of PEOPLE) { await tradeBusiness(u).catch(() => null); await tradeBusinessFile(u).catch(() => null); }
});
afterAll(() => { setSystemTime(); });

const outcome = async <T,>(f: () => Promise<T>) => { try { return { ok: await f() }; } catch (e) { return { refused: (e as Error).message }; } };

async function all(mode: { test?: boolean }, fail: typeof failWhen = null) {
  seed(mode);
  failWhen = fail;
  const out: Record<string, unknown> = {};
  for (const [who, u] of PEOPLE) {
    out[`business ${who}`] = await outcome(() => tradeBusiness(u));
    out[`file ${who}`] = await outcome(() => tradeBusinessFile(u));
  }
  failWhen = null;
  return out;
}

/** Display reads failing (team facts, Mitti records, notice records, electrician cover) and the reads whose failure fails the
 *  loader today (usual electrician; the business row for the business file). */
const FAILURES: [string, NonNullable<typeof failWhen>][] = [
  ["certifications", (t) => t === "partner_worker_certifications"],
  ["notice records", (t) => t === "partner_activations"],
  ["notice application", (t) => t === "rec_onboarding_applications"],
  ["mitti records", (t, s) => t === "admin_config_events" && s === "details"],
  ["team workers", (t) => t === "partner_workers"],
  ["profiles (team)", (t, _s, i) => t === "profiles" && i.includes(" in ")],
  ["usual electrician", (t, _s, i) => t === "admin_config_events" && i.includes("installer_usual_electrician_saved")],
  ["business row", (t, s) => t === "businesses" && !s.startsWith("id, name, business_type")],
  ["credentials", (t) => t === "business_credentials"],
];

describe("parity: same value as before, field for field", () => {
  test("tradeBusiness and tradeBusinessFile for owner, staff, electrician owner/staff and no business (normal and TEST)", async () => {
    const out: Record<string, unknown> = {};
    for (const mode of [{}, { test: true }] as const) out[JSON.stringify(mode)] = await all(mode);
    expect(out).toMatchSnapshot();
  });
  test("with each read failing, the same value or the same refusal as before", async () => {
    const out: Record<string, unknown> = {};
    for (const [name, f] of FAILURES) out[name] = await all({}, f);
    expect(out).toMatchSnapshot();
  });
});

// /field/business and /team draw once tradeBusiness answers; /details and /rates once tradeBusinessFile answers.
describe("rounds", () => {
  // Known limit (no database function, ruling 30 Oct; owner-only reads gated on the owner check as today): round 1 finds the
  // business and whether this person is its owner, round 2 every owner read that needs only the business, round 3 the reads
  // that need the team rows (profiles, Mitti records) and the second step of the CII / notice records.
  for (const [who, u, max, was] of [["installer owner", U_BOSS, 3, 8], ["electrician owner", U_ELEC, 3, 6]] as const) {
    test(`tradeBusiness ${who}: at most ${max} sequential rounds (was ${was})`, async () => {
      failWhen = null; seed();
      const r = await measured(() => tradeBusiness(u));
      expect(r.out.boss).toBe(true);
      if (r.rounds > max) console.log(`tradeBusiness ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(max);
    });
  }
  test("tradeBusiness staff: 1 round (the sign-in context only)", async () => {
    failWhen = null; seed();
    const r = await measured(() => tradeBusiness(U_STAFF));
    expect(r.out.boss).toBe(false);
    expect(r.rounds).toBe(1);
  });
  for (const [who, u, was] of [["installer owner", U_BOSS, 3], ["electrician owner", U_ELEC, 2]] as const) {
    test(`tradeBusinessFile ${who}: at most 2 sequential rounds (was ${was})`, async () => {
      failWhen = null; seed();
      const r = await measured(() => tradeBusinessFile(u));
      expect(r.out.details.name).toBeTruthy();
      if (r.rounds > 2) console.log(`tradeBusinessFile ${who} rounds = ${r.rounds}\n${roundsOf(r.log)}`);
      expect(r.rounds).toBeLessThanOrEqual(2);
    });
  }
});

describe("TEST and real jobs never mix", () => {
  test("the business pages read no jobs at all (one real and one qa_test job on file), normal and TEST business", async () => {
    for (const mode of [{}, { test: true }]) {
      failWhen = null; seed(mode);
      reset();
      for (const [, u] of PEOPLE) { await tradeBusiness(u).catch(() => null); await tradeBusinessFile(u).catch(() => null); }
      await new Promise((r) => setTimeout(r, 5));
      expect(log.map((l) => l.table).filter((t) => ["jobs", "job_assignments", "quotes", "invoices", "bookings", "owners", "properties"].includes(t))).toEqual([]);
      // Each owner sees only their own business.
      expect((await tradeBusinessFile(U_BOSS)).businessId).toBe(B1);
      expect((await tradeBusinessFile(U_ELEC)).businessId).toBe(B2);
    }
  });
});

const OWNER_TABLES = ["business_credentials", "partner_workers", "electrician_rates", "partner_agreements", "business_bank_details", "rate_cards", "rate_card_items", "partner_change_requests", "partner_worker_certifications", "worker_certification_levels", "partner_activations", "rec_onboarding_applications", "admin_config_events"];

describe("staff are refused before any owner-only data is read", () => {
  for (const [who, u] of [["installer staff", U_STAFF], ["electrician staff", U_ESTAFF]] as const) {
    test(`${who}: business shows the staff view only, the business file is refused with the exact message, no owner read made, nothing written`, async () => {
      failWhen = null; seed();
      const before = rowsOf(tables);
      reset();
      const s = await tradeBusiness(u);
      expect(s.boss).toBe(false);
      expect([s.team, s.credentials, s.notice, s.bankLine, s.details, s.agreement, s.rate, s.usualElectrician]).toEqual([[], [], [], null, null, null, null, null]);
      await expect(tradeBusinessFile(u)).rejects.toThrow("Only the business owner can see this.");
      await new Promise((r) => setTimeout(r, 5));
      expect(log.map((l) => l.table).filter((t) => OWNER_TABLES.includes(t))).toEqual([]);
      expect(log.filter((l) => l.table === "businesses" && !l.sel.startsWith("id, name, business_type"))).toEqual([]);
      expect(rowsOf(tables)).toBe(before);
    });
  }
  test("no business: the sign-in refusal wins on both loaders", async () => {
    failWhen = null; seed();
    await expect(tradeBusiness(U_NONE)).rejects.toThrow("Your sign-in isn't linked to an approved business yet.");
    await expect(tradeBusinessFile(U_NONE)).rejects.toThrow("Your sign-in isn't linked to an approved business yet.");
  });
});

describe("failure rules unchanged", () => {
  test("a failed usual-electrician read fails both loaders for an installer owner, as today", async () => {
    seed();
    failWhen = (t, _s, i) => t === "admin_config_events" && i.includes("installer_usual_electrician_saved");
    await expect(tradeBusiness(U_BOSS)).rejects.toThrow("Could not load your usual electrician.");
    await expect(tradeBusinessFile(U_BOSS)).rejects.toThrow("Could not load your usual electrician.");
    failWhen = null;
  });
  test("a failed business row read fails the business file (Business not found.), as today", async () => {
    seed();
    failWhen = (t, s) => t === "businesses" && s.includes("typical_days");
    await expect(tradeBusinessFile(U_ELEC)).rejects.toThrow("Business not found.");
    failWhen = null;
  });
  test("failed team display reads keep their catch: the page still answers, facts unknown, never a false warning", async () => {
    seed();
    failWhen = (t, s) => t === "partner_worker_certifications" || t === "partner_activations" || (t === "admin_config_events" && s === "details");
    const b = await tradeBusiness(U_BOSS);
    failWhen = null;
    expect(b.team.length).toBeGreaterThan(0);
    expect(b.notice).toEqual([]);
    expect(b.team.every((m) => m.mittiRecorded === null)).toBe(true);
  });
  test("a failed electrician cover read leaves the electrician panel out (no false warning), as today", async () => {
    seed();
    failWhen = (t) => t === "partner_activations";
    const b = await tradeBusiness(U_ELEC);
    failWhen = null;
    expect(b.boss).toBe(true);
  });
});
