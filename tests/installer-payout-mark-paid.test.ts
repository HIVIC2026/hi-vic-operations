// Review R09 / audit F19: the office "Mark paid" write enforces the SAME installer-payout eligibility rule the Payouts tab
// displays — our leads (A2) wait for AP approval; installer-supplied (A1) jobs wait for AP approval AND the owner's payment
// in full. The REAL markPayoutPaid handler (office.functions.ts) is invoked directly, as a crafted client call would reach
// it (no UI), against an in-memory backend; the display (moneyPayouts) is read from the same fixture and must agree.
import { describe, expect, mock, test } from "bun:test";
import { INSTALLER_PAY_WAITING_AP, INSTALLER_PAY_WAITING_OWNER, installerPayHeldReasons } from "../src/lib/trade-view.core";

type Ctx = { supabase: unknown; userId: string };
type Call = (a: { data: unknown; context: Ctx }) => Promise<unknown>;
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (f: typeof validate) => { validate = f; return b; },
      handler: (h: (a: { data: unknown; context: Ctx }) => Promise<unknown>): Call => (a) => h({ data: validate(a.data), context: a.context }),
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
// Minimal PostgREST stand-in: eq/in filter on columns present in the row; everything else passes through.
function from(table: string) {
  let rows = [...(tables[table] ?? [])];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => !(c in r) || r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { rows = rows.filter((r) => !(c in r) || v.includes(r[c])); return b; },
    neq: () => b, is: () => b, not: () => b, order: () => b, limit: () => b, gte: () => b, lt: () => b, contains: () => b,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => r({ data: rows, error: null }),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const marked: Row[] = [];
mock.module("../src/lib/workflow.server", () => ({
  requireAdmin: async () => undefined,
  logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: Row) => { const r = { job_id: job, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() }; marked.push(r); tables["workflow_events"]!.push(r); },
}));
// Decision 318 form gate: the A5 is Complete with its evidence (so only the timing rule is under test).
mock.module("../src/lib/trade-payout-gate.server", () => ({
  payoutGateFacts: async (ids: string[]) => new Map(ids.map((id) => [id, { piesa: null, fixes: null, install: { formCompleted: true, evidence: [] } }])),
  payoutBlockersFor: async () => [],
  safetyVisitFacts: async () => new Map(), // batch 1 F5 (per-visit safety check pay)
  safetyVisitPayoutBlockers: async () => [],
}));
const { markPayoutPaid } = await import("../src/lib/office.functions");
const { moneyPayouts } = await import("../src/lib/office-money.server");
const call = markPayoutPaid as unknown as Call;
const ctx: Ctx = { supabase: {}, userId: "office-1" };

const AP = "2026-10-01T00:00:00.000Z", OWNER_PAID = "2026-10-10T00:00:00.000Z";
const PAID_IN_FULL = { status: "fully_paid", balance_paid_at: OWNER_PAID, paid_at: null, updated_at: OWNER_PAID };
const PART_PAID = { status: "deposit_paid", balance_paid_at: null, paid_at: null, updated_at: AP };
function seed(channel: "installer_sourced" | "hivic_sourced", o: { ap: boolean; invoice: Row | null }) {
  marked.length = 0;
  tables["jobs"] = [{ id: "j1", job_number: "HV-0001", stage: "ready_for_veec", source: "website", channel, electrician_choice: null, installation_completed_at: AP, deleted_at: null, owners: { full_name: "Owner" } }];
  tables["bookings"] = [];
  tables["job_assignments"] = [{ job_id: "j1", business_id: "b1", role: "installer", active: true, businesses: { name: "Installer Co", trading_name: null } }];
  tables["quotes"] = [{ id: "q1", job_id: "j1", kind: "installation", status: "accepted" }];
  tables["quote_internals"] = [{ quote_id: "q1", cost_ex_gst: 1000 }];
  tables["workflow_events"] = o.ap ? [{ job_id: "j1", event_type: "stage_changed", to_stage: "ready_for_veec", created_at: AP, details: null }] : [];
  tables["invoices"] = o.invoice ? [{ job_id: "j1", ...o.invoice }] : [];
  tables["pricing_settings"] = [{ piesa_rec_cost_ex_gst: 300, gst_rate: 0.1, is_active: true }];
  tables["electrician_rates"] = [];
}
// The handler validates a uuid job id; the fixture job is keyed by that id.
const JOB = "11111111-1111-4111-8111-111111111111";
const tryMark = async (kind?: "installation") => {
  try { await call({ data: { jobId: JOB, reference: "EFT 123", ...(kind ? { kind } : {}) }, context: ctx }); return null; }
  catch (e) { return (e as Error).message; }
};
function seedJob(channel: "installer_sourced" | "hivic_sourced", o: { ap: boolean; invoice: Row | null }) {
  seed(channel, o);
  tables["jobs"] = tables["jobs"]!.map((r) => ({ ...r, id: JOB }));
  for (const t of ["job_assignments", "quotes", "workflow_events", "invoices"]) tables[t] = tables[t]!.map((r) => ({ ...r, job_id: JOB }));
}
const displayHeld = async () => { const r = await moneyPayouts(); return { held: r.held.flatMap((h) => h.reasons), due: r.due.length }; };

describe("R09: Mark paid (direct invocation) enforces the installer pay rule the Payouts tab shows", () => {
  test("A1 (installer-supplied), AP approved, owner NOT paid in full → refused, nothing recorded; display holds it too", async () => {
    seedJob("installer_sourced", { ap: true, invoice: PART_PAID });
    expect(await tryMark("installation")).toContain(INSTALLER_PAY_WAITING_OWNER);
    expect(await tryMark()).toContain(INSTALLER_PAY_WAITING_OWNER); // kind omitted = installation
    expect(marked).toEqual([]);
    expect(await displayHeld()).toEqual({ held: [INSTALLER_PAY_WAITING_OWNER], due: 0 });
  });
  test("A1, owner paid in full but AP NOT approved → refused; display holds it", async () => {
    seedJob("installer_sourced", { ap: false, invoice: PAID_IN_FULL });
    const m = await tryMark("installation");
    expect(m).toContain("Payout held");
    expect(m).toContain(INSTALLER_PAY_WAITING_AP);
    expect(marked).toEqual([]);
    expect((await displayHeld()).held).toEqual([INSTALLER_PAY_WAITING_AP]);
  });
  test("A1, neither → refused with both reasons", async () => {
    seedJob("installer_sourced", { ap: false, invoice: null });
    const m = await tryMark("installation");
    expect(m).toContain(INSTALLER_PAY_WAITING_AP);
    expect(m).toContain(INSTALLER_PAY_WAITING_OWNER);
    expect(marked).toEqual([]);
  });
  test("A1, AP approved AND owner paid in full → recorded once; display shows it due", async () => {
    seedJob("installer_sourced", { ap: true, invoice: PAID_IN_FULL });
    expect(await displayHeld()).toEqual({ held: [], due: 1 });
    expect(await tryMark("installation")).toBeNull();
    expect(marked.map((e) => e["event_type"])).toEqual(["payout_marked_paid"]);
  });
  test("A2 (our lead), AP NOT approved → refused; display holds it", async () => {
    seedJob("hivic_sourced", { ap: false, invoice: PAID_IN_FULL });
    expect(await tryMark("installation")).toContain(INSTALLER_PAY_WAITING_AP);
    expect(marked).toEqual([]);
    expect((await displayHeld()).held).toEqual([INSTALLER_PAY_WAITING_AP]);
  });
  test("A2, AP approved, owner not paid in full → payable (our leads do not wait for the owner); display agrees", async () => {
    seedJob("hivic_sourced", { ap: true, invoice: PART_PAID });
    expect(await displayHeld()).toEqual({ held: [], due: 1 });
    expect(await tryMark()).toBeNull();
    expect(marked.map((e) => e["event_type"])).toEqual(["payout_marked_paid"]);
  });
});

describe("R09: one pure rule", () => {
  test("installerPayHeldReasons", () => {
    expect(installerPayHeldReasons({ installerSupplied: false, apApprovedAt: AP, ownerPaidInFullAt: null })).toEqual([]);
    expect(installerPayHeldReasons({ installerSupplied: false, apApprovedAt: null, ownerPaidInFullAt: OWNER_PAID })).toEqual([INSTALLER_PAY_WAITING_AP]);
    expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: AP, ownerPaidInFullAt: OWNER_PAID })).toEqual([]);
    expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: AP, ownerPaidInFullAt: null })).toEqual([INSTALLER_PAY_WAITING_OWNER]);
    expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: null, ownerPaidInFullAt: null })).toEqual([INSTALLER_PAY_WAITING_AP, INSTALLER_PAY_WAITING_OWNER]);
  });
});
