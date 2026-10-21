// Central stage guards against an in-memory fake database (no network, no real writes).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PAYMENT_RULE_PENDING } from "../src/lib/payment-gate.core";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  let op = "select";
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] !== v); return q; },
    in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
    not: () => q, order: () => q, limit: (n: number) => { rows = rows.slice(0, n); return q; },
    update: () => { op = "update"; return q; }, insert: () => { op = "insert"; return q; }, delete: () => { op = "delete"; return q; },
    maybeSingle: async () => ({ data: op === "select" ? rows[0] ?? null : null, error: null }),
    single: async () => ({ data: op === "select" ? rows[0] ?? null : null, error: rows[0] ? null : { message: "none" } }),
    then: (res: (v: unknown) => unknown) => res({ data: op === "select" ? rows : null, count: rows.length, error: null }),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
const { stageEntryBlockers, CONSUMER_SIGN_BLOCKER, ASSIGNMENT_VEEC_BLOCKER, COMMERCIAL_BLOCKER } = await import("../src/lib/workflow.server");
const { installationDateBlocker } = await import("../src/lib/workflow");

const J = "job-1";
const future = new Date(Date.now() + 30 * 864e5).toISOString();
// Owner paperwork gates A–D are covered by their own tests; these check payment/signing gates only.
const notPaperwork = (b: string[]) => b.filter((x) => !x.startsWith("Owner paperwork "));
function seed(over: Partial<Record<string, Row[]>> = {}) {
  tables = {
    jobs: [{ id: J, channel: "hivic_sourced", commercial_model: "hivic_invoices_owner", stage: "assessment_booked" }],
    owner_authorities: [{ id: "oa", job_id: J, version: 1, status: "accepted", expires_at: future }],
    job_piesa_deadlines: [{ job_id: J, piesa_date: "2026-09-20", piesa_outcome: "pass", piesa_expired: false, install_deadline: "2026-10-20" }],
    assessments: [{ job_id: J, status: "complete" }],
    ceiling_measurements: [{ job_id: J, is_current: true, status: "complete", measured_area_m2: 120 }],
    quotes: [{ job_id: J, kind: "installation", status: "accepted" }],
    invoices: [{ id: "inv", job_id: J, kind: "installation", deposit_paid_at: "2026-09-21" }],
    customer_agreements: [{ id: "ag", job_id: J, status: "signed" }],
    customer_assignments: [],
    payment_overrides: [], rectification_items: [], job_assignments: [], evidence_requirements: [], compliance_checks: [], veec_lodgements: [], workflow_events: [],
    ...over,
  };
}
beforeEach(() => seed());

describe("measurement gate (new)", () => {
  test("8 quote stages blocked without an accepted measure-up", async () => {
    seed({ ceiling_measurements: [] });
    expect(await stageEntryBlockers(J, "ready_for_installer_quotes")).toContain("Ready Check missing.");
    seed({ ceiling_measurements: [{ job_id: J, is_current: true, status: "needs_review", measured_area_m2: 120 }] });
    expect(await stageEntryBlockers(J, "awaiting_quote_acceptance")).toContain("Ready Check needs review / missing evidence.");
    seed();
    expect((await stageEntryBlockers(J, "ready_for_installer_quotes")).some((b) => /measure-up/i.test(b))).toBe(false);
  });
  test("assessment_complete is retired: entry refused before any other check", async () => {
    seed({ assessments: [{ job_id: J, status: "draft" }] });
    expect((await stageEntryBlockers(J, "assessment_complete"))[0]).toContain("is retired");
    seed();
    expect(await stageEntryBlockers(J, "assessment_complete")).toHaveLength(1); // even with everything complete
  });
});

describe("existing guards unchanged", () => {
  test("10 PIESA 30-day expiry still blocks installation", async () => {
    seed({ job_piesa_deadlines: [{ job_id: J, piesa_date: "2026-08-01", piesa_outcome: "pass", piesa_expired: true, install_deadline: "2026-08-31" }] });
    expect((await stageEntryBlockers(J, "installation_scheduling")).some((b) => b.startsWith("PIESA 30-day window expired"))).toBe(true);
    expect(installationDateBlocker({ install_deadline: "2026-10-20" }, "2026-10-25T01:00:00Z")).toMatch(/before the PIESA deadline/);
  });
  test("11 installer-sourced commercial gate unchanged", async () => {
    seed({ jobs: [{ id: J, channel: "installer_sourced", commercial_model: "not_configured" }] });
    expect(await stageEntryBlockers(J, "awaiting_deposit_payment")).toContain(COMMERCIAL_BLOCKER);
  });
  test("13 assessment no longer needs Owner Authority; signing + deposit gates hold", async () => {
    seed({ owner_authorities: [] });
    expect((await stageEntryBlockers(J, "assessment_booked"))[0]).toContain("is retired");
    seed({ customer_agreements: [] });
    expect(await stageEntryBlockers(J, "installation_scheduling")).toContain(CONSUMER_SIGN_BLOCKER);
    seed();
    expect(await stageEntryBlockers(J, "ready_for_veec")).toContain(ASSIGNMENT_VEEC_BLOCKER);
    seed({ invoices: [{ id: "inv", job_id: J, kind: "installation", deposit_paid_at: null }] });
    expect((await stageEntryBlockers(J, "rectification_scheduling")).some((b) => b === PAYMENT_RULE_PENDING)).toBe(true); // switch off: no 50% fallback
    seed();
    expect(notPaperwork(await stageEntryBlockers(J, "installation_scheduling"))).toEqual([PAYMENT_RULE_PENDING]);
  });
});

describe("Activity 48 sequence gates", () => {
  test("signed agreement alone never satisfies ready_for_veec; legacy quote-time record never counts", async () => {
    seed();
    expect(await stageEntryBlockers(J, "ready_for_veec")).toContain(ASSIGNMENT_VEEC_BLOCKER);
    seed({ customer_assignments: [{ id: "x", job_id: J, status: "effective_complete", record_kind: "legacy_quote_time" }] });
    expect(await stageEntryBlockers(J, "ready_for_veec")).toContain(ASSIGNMENT_VEEC_BLOCKER);
    seed({ customer_assignments: [{ id: "y", job_id: J, status: "effective_complete", record_kind: "final_veec_assignment" }] });
    expect(await stageEntryBlockers(J, "ready_for_veec")).not.toContain(ASSIGNMENT_VEEC_BLOCKER);
  });
  test("agreement unlocks deposit stage (invoice path) without any VEEC assignment", async () => {
    seed();
    expect(notPaperwork(await stageEntryBlockers(J, "awaiting_deposit_payment"))).toEqual([]);
  });
});
