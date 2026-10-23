import { expect, mock, test } from "bun:test";

const reads: string[] = [];
let inFlight = 0;
let peak = 0;
const rows: Record<string, unknown> = {
  customer_estimate_links: { job_id: "test-job", status: "active", expires_at: "2099-01-01" },
  jobs: { job_number: "HV-TEST", stage: "measured_estimate_ready", channel: "hivic_sourced", owners: { full_name: "TEST Owner" }, properties: null },
  quotes: [{ id: "q", status: "issued", release_state: "released", customer_total_inc_gst: 3830.25, veec_discount_inc_gst: 1050, version: 1, quote_items: [] }],
  bookings: [{ kind: "assessment", status: "proposed" }],
  invoices: [],
  indicative_estimates: { applied_discount: 900 },
  workflow_settings: { safety_check_payment_inc_gst: 349, piesa_install_window_days: 30 },
};
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  const q: any = { select() { return q; }, eq() { return q; }, in() { return q; }, is() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; }, single() { return q; }, then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    reads.push(table); inFlight++; peak = Math.max(peak, inFlight);
    return new Promise(r => setTimeout(() => { inFlight--; r({ data: rows[table] ?? null, error: null }); }, 2)).then(resolve, reject);
  } }; return q;
} } }));
const { resolveOwnerJob } = await import("../src/lib/owner-myjob.server");
test("secure owner read reuses payment settings, preserves rebate and cancellation, and stays within six slots", async () => {
  const view = await resolveOwnerJob("a".repeat(64));
  expect(view?.numbers.rebate).toBe(1050);
  expect(view?.quote?.total).toBe(3830.25);
  expect(view?.quote?.split?.deposit).toBe(349);
  expect(view?.canCancel).toBe(false);
  expect(reads.filter(t => t === "workflow_settings")).toHaveLength(1);
  expect(peak).toBeLessThanOrEqual(6);
});
test("malformed capability causes no job reads", async () => {
  reads.length = 0;
  expect(await resolveOwnerJob("bad")).toBeNull();
  expect(reads).toEqual([]);
});