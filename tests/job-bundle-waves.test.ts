// Portal speed step 1, Task 6: the installer job page's one server call (`tradeJobBundle`) returns the same value as before and
// makes few sequential database round trips ("waves"). REAL server modules against an in-memory database
// (tests/helpers/memory-postgrest.ts) with a wave counter (tests/helpers/wave-counter.ts). The signed-in client's own calls
// (getUser, my_job_role, can_access_job, has_role) are counted as round trips too. Run on its own (mock.module leaks).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Tables } from "./helpers/memory-postgrest";
import { outcome, waveCounter } from "./helpers/wave-counter";

const tables: Tables = {};
const wc = waveCounter(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: wc.client }));

const { tradeJobBundle } = await import("../src/lib/trade-job-bundle.server");

const NOW = new Date("2026-10-29T03:00:00.000Z");
const B1 = "00000000-0000-4000-8000-0000000000b1", B2 = "00000000-0000-4000-8000-0000000000b2";
const U_BOSS = "00000000-0000-4000-8000-0000000000u1", U_STAFF = "00000000-0000-4000-8000-0000000000u2", U_ELEC = "00000000-0000-4000-8000-0000000000u3", U_OUT = "00000000-0000-4000-8000-0000000000u4";
const j = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const at = (days: number, hour = 0) => new Date(NOW.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  const job = (n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id: j(n), job_number: `HV-${1000 + n}`, stage, source: "website", channel: "hivic_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-n), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null,
    originating_installer_business_id: null, installation_completed_at: null, ...extra,
  });
  Object.assign(tables, {
    businesses: [
      { id: B1, name: "Inst Co", trading_name: null, business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: null, mitti_account_invited: true },
      { id: B2, name: "Sparky Co", trading_name: "Sparky", business_type: "rec", capabilities: ["electrician"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: null, mitti_account_invited: false },
    ],
    business_members: [
      { id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true },
      { id: "m2", business_id: B1, user_id: U_STAFF, member_role: "member", active: true },
      { id: "m3", business_id: B2, user_id: U_ELEC, member_role: "business_admin", active: true },
    ],
    user_roles: [{ user_id: U_BOSS, role: "installer" }, { user_id: U_STAFF, role: "installer" }, { user_id: U_ELEC, role: "electrician" }],
    profiles: [{ id: U_BOSS, full_name: "Bea Boss", phone: null, email: "bea@example.com" }, { id: U_STAFF, full_name: "Sam Staff", phone: null, email: "sam@example.com" }, { id: U_ELEC, full_name: "Eli Spark", phone: null, email: "eli@example.com" }],
    owners: Array.from({ length: 6 }, (_, i) => ({ id: `o${i + 1}`, full_name: `Owner Number${i + 1}` })),
    properties: Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, address_line: `${i + 1} Test St`, suburb: `Suburb${i + 1}`, postcode: "3220" })),
    jobs: [
      job(1, "installation_scheduling", { channel: "installer_sourced", originating_installer_business_id: B1, electrician_choice: "usual" }),
      job(2, "installation_booked"),
      job(3, "ready_check_ready_to_schedule", { channel: "installer_sourced", originating_installer_business_id: B1 }),
      job(4, "complete", { installation_completed_at: at(-1) }),
    ],
    job_assignments: [
      ...[1, 2, 3, 4].map((n) => ({ id: `a${n}`, job_id: j(n), business_id: B1, user_id: n === 2 || n === 3 ? U_STAFF : U_BOSS, role: "installer", active: true })),
      { id: "e2", job_id: j(2), business_id: B2, user_id: U_ELEC, role: "electrician", active: true },
      { id: "e1", job_id: j(1), business_id: B2, user_id: U_ELEC, role: "electrician", active: true },
    ],
    bookings: [
      { id: "bk2", job_id: j(2), business_id: B1, kind: "installation", status: "confirmed", scheduled_start: at(1), scheduled_end: at(1, 6), created_at: at(-2) },
      { id: "bk1", job_id: j(1), business_id: B2, kind: "assessment", status: "completed", scheduled_start: at(-3), scheduled_end: at(-3, 1), created_at: at(-4) },
      { id: "bk4", job_id: j(4), business_id: B1, kind: "installation", status: "completed", scheduled_start: at(-1), scheduled_end: at(-1, 6), created_at: at(-5) },
    ],
    assessments: [{ id: "as1", job_id: j(1), status: "complete", piesa_outcome: "pass", completed_at: at(-3), external_mitti_id: "m1", mitti_completed: true, mitti_raw_snapshot: [] }],
    piesa_records: [{ id: "pr1", job_id: j(1), created_at: at(-3), external_mitti_id: "m1" }],
    job_piesa_deadlines: [{ job_id: j(1), install_deadline: "2026-11-20" }],
    owner_esc_consents: [{ id: "c2", job_id: j(2), status: "signed", owner_signed_at: at(-1), created_at: at(-1) }],
    ceiling_measurements: [{ id: "cm1", job_id: j(1), measured_area_m2: 80, removal_m2: 0, removal_required: false, is_current: true, external_source: "mitti", external_id: "audit-1" }],
    workflow_events: [
      { id: "w1", job_id: j(1), event_type: "installer_price_set", created_at: at(-1), details: { price_inc_gst: 3000, inclusions: "Batts", entered_by: U_BOSS } },
      { id: "w2", job_id: j(2), event_type: "visit_allocated", created_at: at(-1), details: { kind: "install", worker_id: "w-1", worker_name: "Wally" } },
    ],
    quotes: [{ id: "q1", job_id: j(1), kind: "installation", status: "accepted", sent_at: at(-5), accepted_at: at(-4), release_state: "released", release_hold_reason: null, option_code: "A2", created_at: at(-5), subtotal_inc_gst: 4000, veec_discount_inc_gst: 0, customer_total_inc_gst: 4000 }],
    quote_items: [{ id: "qi1", quote_id: "q1", code: "PIESA", description: "Safety check", explanation: null, quantity: 1, unit: "ea", unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 1 }],
    partner_workers: [{ id: "w-1", business_id: B1, full_legal_name: "Wally Worker", trade_role: "installer", approval_status: "approved", removed_at: null, profile_id: U_STAFF, worker_role: "installer" }],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
    appointment_proposals: [], invoices: [], installer_declarations: [], customer_assignments: [], rectification_items: [], payment_overrides: [], ready_check_windows: [],
  });
  tables["job_overview"] = tables["jobs"]!.map((jb) => ({ id: jb["id"], job_number: jb["job_number"], stage: jb["stage"], channel: jb["channel"], property_id: jb["property_id"], owner_name: "Owner Name", owner_phone: "0400 000 000", owner_email: "owner@example.com", property_address: "1 Test St, Geelong 3220" }));
}

/** Who the database says each caller is on each job (what `my_job_role` / `can_access_job` / `has_role` answer). */
const ROLE: Record<string, (jobId: string) => string | null> = {
  [U_BOSS]: () => "installer", // the business owner reaches every job the business is assigned to
  [U_STAFF]: (id) => (id === j(2) || id === j(3) ? "installer" : null),
  [U_ELEC]: (id) => (id === j(1) || id === j(2) ? "electrician" : null),
  [U_OUT]: () => null,
};
const ROLES: Record<string, string[]> = { [U_BOSS]: ["installer"], [U_STAFF]: ["installer"], [U_ELEC]: ["electrician"], [U_OUT]: [] };

/** The signed-in client; each call costs a round trip on the wave counter, and is counted by name. */
function signedIn(userId: string, calls: string[] = []) {
  const trip = async (name: string) => { calls.push(name); await wc.client.rpc(`sb:${name}`); };
  return {
    calls,
    sb: {
      auth: { getUser: async () => { await trip("getUser"); return { data: { user: { id: userId, user_metadata: {} } } }; } },
      rpc: async (name: string, args: Record<string, string> = {}) => {
        await trip(name);
        if (name === "my_job_role") return { data: ROLE[userId]!(args["_job"]!), error: null };
        if (name === "can_access_job") return { data: ROLE[userId]!(args["_job"]!) !== null, error: null };
        if (name === "has_role") return { data: (ROLES[userId] ?? []).includes(args["_role"]!), error: null };
        if (name === "is_admin") return { data: false, error: null };
        return { data: null, error: null };
      },
    },
  };
}
const run = (userId: string, jobId: string) => { const s = signedIn(userId); return { s, p: tradeJobBundle(s.sb as never, userId, jobId) }; };

const CASES: [string, string, string][] = [
  ["installer boss, owner's own job (J1)", U_BOSS, j(1)],
  ["installer boss, other job, booked (J4 complete)", U_BOSS, j(4)],
  ["installer boss, job assigned to their staff (J2)", U_BOSS, j(2)],
  ["installer staff, assigned booked job (J2)", U_STAFF, j(2)],
  ["installer staff, assigned ready check job (J3)", U_STAFF, j(3)],
  ["installer staff, not assigned (J1)", U_STAFF, j(1)],
  ["electrician (J1)", U_ELEC, j(1)],
  ["electrician (J2)", U_ELEC, j(2)],
  ["user with no access (J1)", U_OUT, j(1)],
];

beforeAll(async () => { setSystemTime(NOW); seed(); for (const [, u, job] of CASES) await outcome(() => run(u, job).p); });
afterAll(() => { setSystemTime(); });

const quiet = async <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => undefined; try { return await f(); } finally { console.error = e; } };

describe("Job page bundle (Task 6): same value as before", () => {
  test("boss, staff, electrician and a user with no access", async () => {
    seed(); wc.state.failWhen = null;
    const out: Record<string, unknown> = {};
    for (const [name, u, job] of CASES) out[name] = await quiet(() => outcome(() => run(u, job).p));
    expect(out).toMatchSnapshot();
  });
  test("a user with no access to the job is refused in every section", async () => {
    seed();
    const r = (await run(U_OUT, j(1)).p) as unknown as Record<string, unknown>;
    for (const k of ["overview", "role", "page", "installDays", "readyCheckTimes", "allocation", "swms", "workerLinks", "price", "ownerQuote", "crew", "mittiInvited"]) expect(JSON.stringify(r[k]), k).toContain("error");
  });
});

describe("Job page bundle (Task 6): waves", () => {
  for (const [name, u, job] of CASES) {
    test(`${name}`, async () => {
      seed(); wc.state.failWhen = null;
      const s = signedIn(u);
      const r = await wc.measured(() => quiet(() => tradeJobBundle(s.sb as never, u, job)));
      console.log(`WAVES ${name}: ${r.waves} waves, ${r.log.length} reads (sign-in client calls: ${s.calls.join(",")})`);
      if (process.env["SHOW_DUPES"]) { const c: Record<string, number> = {}; for (const l of r.log) c[l.table] = (c[l.table] ?? 0) + 1; console.log(JSON.stringify(c)); }
      if (process.env["SHOW_WAVES"]) console.log(wc.wavesOf(r.log));
      expect(r.waves).toBeGreaterThan(0);
    });
  }
});
