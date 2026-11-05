// Portal speed step 1, Task 7: My business (`tradeBusiness`) reads in few sequential waves after the sign-in context and returns
// the same value as before (installer and electrician; owner and staff; normal and TEST; with display reads failing; with the
// office-stamp column missing). `loadTeamWorkers` reads the team once, never asks for `declarations_due` (Jo 5 Nov 2026: the
// worker declarations are dropped), and when the licence/ESC stamp columns are missing it re-reads the base columns. REAL server
// modules against an in-memory database with a wave counter (tests/helpers/wave-counter.ts). The fixture is the
// trade-business-speed one. Run on its own.
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Tables } from "./helpers/memory-postgrest";
import { COLLECTION_NOTICE_SHA256 } from "../src/lib/esc-collection-notice.core";
import { outcome, waveCounter } from "./helpers/wave-counter";
import { addForeignBusiness, foreignTraces } from "./helpers/business-scope";

const tables: Tables = {};
const wc = waveCounter(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: wc.client }));

const { tradeBusiness } = await import("../src/lib/trade-view.server");
await import("../src/lib/team-required.core"); // loaded on first use: loaded now so a first module load never splits a wave

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

/** Dates of birth on file (read as yes/no): the staff installer has one, the no-login installer doesn't. */
function seedAll(opts: { test?: boolean } = {}) {
  seed(opts);
  tables["partner_worker_identity"] = [{ id: "pi1", worker_id: W_STAFF, date_of_birth: "1990-01-01" }, { id: "pi2", worker_id: W_NOLOGIN, date_of_birth: null }, { id: "pi3", worker_id: W_ESTAFF, date_of_birth: "1985-05-05" }];
}

const PEOPLE = [["owner", U_BOSS], ["staff", U_STAFF], ["electrician owner", U_ELEC], ["electrician staff", U_ESTAFF], ["no business", U_NONE]] as const;

beforeAll(async () => {
  setSystemTime(NOW);
  seedAll();
  for (const [, u] of PEOPLE) await tradeBusiness(u).catch(() => null); // warm the module cache
});
afterAll(() => { setSystemTime(); });

async function all(mode: { test?: boolean }, fail: typeof wc.state.failWhen = null) {
  seedAll(mode);
  wc.state.failWhen = fail;
  const out: Record<string, unknown> = {};
  for (const [who, u] of PEOPLE) out[who] = await outcome(() => tradeBusiness(u));
  wc.state.failWhen = null;
  return out;
}

const FAILURES: [string, NonNullable<typeof wc.state.failWhen>][] = [
  ["certifications", (t) => t === "partner_worker_certifications"],
  ["notice records", (t) => t === "partner_activations"],
  ["notice application", (t) => t === "rec_onboarding_applications"],
  ["mitti records", (t, s) => t === "admin_config_events" && s === "details"],
  ["team workers", (t) => t === "partner_workers"],
  ["profiles (team)", (t, _s, i) => t === "profiles" && i.includes(" in ")],
  ["usual electrician", (t, _s, i) => t === "admin_config_events" && i.includes("installer_usual_electrician_saved")],
  ["business row", (t, s) => t === "businesses" && !s.startsWith("id, name, business_type")],
  ["credentials", (t) => t === "business_credentials"],
  ["dates of birth", (t) => t === "partner_worker_identity"],
  ["members", (t, _s, i) => t === "business_members" && i.includes("eq business_id")],
];

const quiet = async <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => undefined; try { return await f(); } finally { console.error = e; } };

describe("My business (Task 7): same value as before", () => {
  test("owner, staff, electrician owner/staff and no business (normal and TEST)", async () => {
    const out: Record<string, unknown> = {};
    for (const mode of [{}, { test: true }] as const) out[JSON.stringify(mode)] = await all(mode);
    expect(out).toMatchSnapshot();
  });
  test("with each read failing: the same value or the same refusal", async () => {
    const out: Record<string, unknown> = {};
    for (const [name, f] of FAILURES) out[name] = await quiet(() => all({}, f));
    expect(out).toMatchSnapshot();
  });
  test("the fixture exercises the team facts", async () => {
    seedAll();
    const b = await tradeBusiness(U_BOSS);
    const staff = b.team.find((m) => m.id === W_STAFF)!, nologin = b.team.find((m) => m.id === W_NOLOGIN)!;
    // The fixture row still carries a stale declarations_due: true; it is ignored (Jo 5 Nov 2026).
    expect((staff as unknown as Record<string, unknown>)["declarationsDue"]).toBeUndefined();
    expect(JSON.stringify(nologin.missingDetails)).not.toBe(JSON.stringify(staff.missingDetails));
    expect(b.usualElectrician?.name).toBe("New Sparky");
  });
});

describe("My business (Task 7): waves after the sign-in context", () => {
  for (const [who, u] of [["installer owner", U_BOSS], ["electrician owner", U_ELEC]] as const) {
    test(`tradeBusiness ${who}: at most 3 waves after the sign-in context`, async () => {
      wc.state.failWhen = null; seedAll();
      const r = await wc.measured(() => tradeBusiness(u));
      expect(r.out.boss).toBe(true);
      console.log(`tradeBusiness ${who}: ${r.afterCtx} waves after ctx (${r.waves} total)`);
      if (r.afterCtx > 3) console.log(wc.wavesOf(r.log));
      expect(r.afterCtx).toBeLessThanOrEqual(3);
    });
  }
  test("loadTeamWorkers: one team read per page load, and it never asks for declarations_due", async () => {
    wc.state.failWhen = null; seedAll();
    for (let i = 0; i < 2; i++) {
      const r = await wc.measured(() => tradeBusiness(U_ELEC));
      expect(r.log.filter((l) => l.table === "partner_workers" && l.sel.includes("full_legal_name, trade_role, approval_status")).map((l) => l.sel.includes("declarations_due"))).toEqual([false]);
    }
  });
});

describe("My business (Task 7): office stamp columns missing (before 0182/0184)", () => {
  const teamReads = async (u: string) => (await wc.measured(() => tradeBusiness(u))).log.filter((l) => l.table === "partner_workers" && l.sel.includes("full_legal_name, trade_role, approval_status")).map((l) => l.sel.includes("licence_verified_at"));
  test("the team is re-read with the base columns only, in at most 3 waves after the sign-in context", async () => {
    wc.state.failWhen = null; seedAll();
    wc.state.missingColumns.add("partner_workers.licence_verified_at");
    try {
      const r = await wc.measured(() => tradeBusiness(U_BOSS));
      expect(r.out.boss).toBe(true);
      if (r.afterCtx > 3) console.log(wc.wavesOf(r.log));
      expect(r.afterCtx).toBeLessThanOrEqual(3);
      expect(await teamReads(U_ELEC)).toEqual([true, false]);
    } finally { wc.state.missingColumns.clear(); }
  });
});

// Portal speed step 2 (plan Review Focus 5): another business's sign-in, job, booking, offer, worker, credential, bank
// details and payout change nothing on this screen, for every caller.
describe("My business and Team: business-scoped", () => {
  test("another business's rows never reach the answer", async () => {
    wc.state.failWhen = null;
    for (const [who, u] of [["installer owner", U_BOSS], ["installer staff", U_STAFF], ["electrician owner", U_ELEC], ["electrician staff", U_ESTAFF], ["no business", U_NONE]] as const) {
      seedAll();
      const before = await outcome(() => tradeBusiness(u));
      addForeignBusiness(tables, at(-1));
      const after = await outcome(() => tradeBusiness(u));
      expect({ who, traces: foreignTraces(after) }).toEqual({ who, traces: [] });
      expect(after).toEqual(before);
    }
  });
});
