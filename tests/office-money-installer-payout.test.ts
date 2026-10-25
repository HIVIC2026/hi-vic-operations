// Audit F19: the office Payouts tab dates installer pay with the SAME payState as the installer's Money screen. Our leads:
// 7 days after AP approval. Installer-supplied (A1) jobs: 7 days after the LATER of AP approval and the owner's payment in
// full — and while the owner hasn't paid in full, the line is Held (never in a Mark paid group).
import { describe, expect, mock, test } from "bun:test";
import { INSTALLER_PAY_WAITING_OWNER, ownerPaidInFullAt, payState } from "../src/lib/trade-view.core";

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
    then: (r: (v: unknown) => unknown) => r({ data: rows, error: null }),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/trade-payout-gate.server", () => ({
  payoutGateFacts: async (ids: string[]) => new Map(ids.map((id) => [id, { piesa: null, fixes: null, install: { formCompleted: true, evidence: [] } }])),
}));
const { moneyPayouts } = await import("../src/lib/office-money.server");

const AP = "2026-10-01T00:00:00.000Z", OWNER_PAID = "2026-10-10T00:00:00.000Z";
const day7 = (iso: string) => new Date(Date.parse(iso) + 7 * 86_400_000).toISOString();
function seed(channel: string, invoice: Row | null) {
  tables["jobs"] = [{ id: "j1", job_number: "HV-0001", stage: "ready_for_veec", source: "website", channel, electrician_choice: null, installation_completed_at: AP, deleted_at: null, owners: { full_name: "Owner" } }];
  tables["bookings"] = [];
  tables["job_assignments"] = [{ job_id: "j1", business_id: "b1", role: "installer", active: true, businesses: { name: "Installer Co", trading_name: null } }];
  tables["quotes"] = [{ id: "q1", job_id: "j1", kind: "installation", status: "accepted" }];
  tables["quote_internals"] = [{ quote_id: "q1", cost_ex_gst: 1000 }];
  tables["workflow_events"] = [{ job_id: "j1", event_type: "stage_changed", to_stage: "ready_for_veec", created_at: AP, details: null }];
  tables["invoices"] = invoice ? [{ job_id: "j1", ...invoice }] : [];
  tables["pricing_settings"] = [{ piesa_rec_cost_ex_gst: 300, gst_rate: 0.1, is_active: true }];
  tables["electrician_rates"] = [];
}

describe("office installer payout date = installer's payState (audit F19)", () => {
  test("A1 job, owner pays in full AFTER AP approval → due 7 days after the owner's payment (not AP + 7)", async () => {
    seed("installer_sourced", { status: "fully_paid", balance_paid_at: OWNER_PAID, paid_at: null, updated_at: OWNER_PAID });
    const r = await moneyPayouts();
    expect(r.held).toEqual([]);
    expect(r.due).toHaveLength(1);
    expect(r.due[0]!.dueAt).toBe(day7(OWNER_PAID));
    expect(r.due[0]!.dueAt).not.toBe(day7(AP));
    // the installer's own screen says the same
    expect(payState({ paidAt: null, apApprovedAt: AP, installerSupplied: true, ownerPaidInFullAt: OWNER_PAID })).toEqual({ kind: "coming", on: day7(OWNER_PAID) });
  });
  test("A1 job, owner not paid in full yet → Held with the waiting reason, no due date", async () => {
    seed("installer_sourced", { status: "deposit_paid", balance_paid_at: null, paid_at: null, updated_at: AP });
    const r = await moneyPayouts();
    expect(r.due).toEqual([]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]!.reasons).toContain(INSTALLER_PAY_WAITING_OWNER);
    expect(r.held[0]!.dueAt).toBeNull();
  });
  test("our lead (A2/HIV) → AP + 7 days regardless of the owner's payment", async () => {
    seed("hivic_sourced", null);
    const r = await moneyPayouts();
    expect(r.due[0]!.dueAt).toBe(day7(AP));
  });
  test("ownerPaidInFullAt: every invoice fully paid → latest paid time; otherwise null", () => {
    expect(ownerPaidInFullAt([])).toBeNull();
    expect(ownerPaidInFullAt([{ status: "fully_paid", balance_paid_at: OWNER_PAID }, { status: "deposit_paid", balance_paid_at: null }])).toBeNull();
    expect(ownerPaidInFullAt([{ status: "fully_paid", balance_paid_at: AP }, { status: "fully_paid", balance_paid_at: OWNER_PAID }])).toBe(OWNER_PAID);
  });
});
