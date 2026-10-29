// Batch 1 final fix F5: after a reopen (or a 30-day repeat) the electrician who did the NEW safety check gets their own
// payout line — never the old visit's "Paid", never the old completed A3 form. One line per completed safety-check visit;
// a payment names its visit (booking_id); a legacy payment (no booking_id) pays the first visit only. Decision 410
// (approve, then 7 days) is unchanged. The REAL moneyPayouts and payout gate run against an in-memory database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { safetyVisitPaidAt, visitGateFacts, PAYOUT_FORM_NOT_COMPLETE, type SafetyVisitFacts, type TradePayoutFacts } from "../src/lib/trade-payout-gate.core";

const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: memoryPostgrest(tables) }));
mock.module("../src/lib/installer-paid-electricians.server", () => ({ safetyCheckPayeesFor: async () => new Map() }));
const { moneyPayouts } = await import("../src/lib/office-money.server");

const V1 = "2026-10-05T00:00:00.000Z", V2 = "2026-10-25T00:00:00.000Z";
const visits: SafetyVisitFacts = {
  visits: [{ id: "v1", start: V1, businessId: "e1", status: "completed" }, { id: "v2", start: V2, businessId: "e2", status: "completed" }],
  records: [{ created_at: "2026-10-06T00:00:00.000Z", external_mitti_id: "m1" }, { created_at: "2026-10-26T00:00:00.000Z", external_mitti_id: null }],
  formExternalId: "m1",
  approvals: [{ at: "2026-10-07T00:00:00.000Z", bookingId: null }],
};
const base: TradePayoutFacts = { piesa: { mittiForm: true, completed: true, evidence: [], completedAt: "2026-10-06T00:00:00.000Z" }, fixes: null, install: null, electricianApprovedAt: { assessment: "2026-10-07T00:00:00.000Z", rectification: null } };
const paid = (at: string, booking?: string) => ({ created_at: at, details: { kind: "assessment", ...(booking ? { booking_id: booking } : {}) } });

describe("which visit a payment pays", () => {
  test("legacy payment (no booking id) pays the first visit only", () => {
    expect(safetyVisitPaidAt([paid("2026-10-15T00:00:00.000Z")], visits, "v1")).toBe("2026-10-15T00:00:00.000Z");
    expect(safetyVisitPaidAt([paid("2026-10-15T00:00:00.000Z")], visits, "v2")).toBeNull();
  });
  test("a payment naming a visit pays that visit only", () => {
    expect(safetyVisitPaidAt([paid("2026-10-28T00:00:00.000Z", "v2")], visits, "v2")).toBe("2026-10-28T00:00:00.000Z");
    expect(safetyVisitPaidAt([paid("2026-10-28T00:00:00.000Z", "v2")], visits, "v1")).toBeNull();
  });
  test("a legacy payment made before the first visit started does not pay it (the old visit was cancelled)", () => {
    const later = { ...visits, visits: [visits.visits[1]!] };
    expect(safetyVisitPaidAt([paid("2026-10-15T00:00:00.000Z")], later, "v2")).toBeNull();
  });
  test("no visit known (older job): any safety check payment counts, as before", () => {
    expect(safetyVisitPaidAt([paid("2026-10-15T00:00:00.000Z")], undefined, null)).toBe("2026-10-15T00:00:00.000Z");
  });
});

describe("the form gate for each visit (decision 318)", () => {
  test("first visit keeps the job's form and approval", () => expect(visitGateFacts(base, visits, "v1")).toEqual(base));
  test("later visit with only a portal record: form not Complete, the old approval doesn't count", () => {
    const f = visitGateFacts(base, visits, "v2");
    expect(f.piesa).toMatchObject({ mittiForm: false, completed: false });
    expect(f.electricianApprovedAt?.assessment).toBeNull();
  });
  test("later visit recorded from the A3 form completed after it: uses that form; an Approve naming it counts", () => {
    const v = { ...visits, records: [...visits.records, { created_at: "2026-10-27T00:00:00.000Z", external_mitti_id: "m1" }], approvals: [...visits.approvals, { at: "2026-10-28T00:00:00.000Z", bookingId: "v2" }] };
    const b = { ...base, piesa: { ...base.piesa!, completedAt: "2026-10-27T00:00:00.000Z" } };
    const f = visitGateFacts(b, v, "v2");
    expect(f.piesa).toEqual(b.piesa);
    expect(f.electricianApprovedAt?.assessment).toBe("2026-10-28T00:00:00.000Z");
    // …and that Approve does not count for the first visit.
    expect(visitGateFacts(b, v, "v1").electricianApprovedAt?.assessment).toBe("2026-10-07T00:00:00.000Z");
  });
});

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    jobs: [
      { id: "j1", job_number: "HV-0701", stage: "piesa_complete", source: "website", channel: "hivic_sourced", electrician_choice: null, originating_installer_business_id: null, installation_completed_at: null, deleted_at: null },
      { id: "j2", job_number: "HV-0702", stage: "piesa_complete", source: "website", channel: "hivic_sourced", electrician_choice: null, originating_installer_business_id: null, installation_completed_at: null, deleted_at: null },
    ],
    owners: [],
    businesses: [{ id: "e1", name: "Old Sparks", trading_name: null }, { id: "e2", name: "New Sparks", trading_name: null }],
    // After the reopen the active electrician is the new one; the old assignment ended at cancel.
    job_assignments: [
      { id: "a1", job_id: "j1", business_id: "e1", role: "electrician", active: false },
      { id: "a2", job_id: "j1", business_id: "e2", role: "electrician", active: true },
      { id: "a3", job_id: "j2", business_id: "e1", role: "electrician", active: true },
    ],
    bookings: [
      { id: "v1", job_id: "j1", kind: "assessment", status: "completed", scheduled_start: V1, business_id: "e1" },
      { id: "v2", job_id: "j1", kind: "assessment", status: "completed", scheduled_start: V2, business_id: "e2" },
      { id: "w1", job_id: "j2", kind: "assessment", status: "completed", scheduled_start: V1, business_id: "e1" },
    ],
    assessments: [
      { id: "as1", job_id: "j1", external_mitti_id: "m1", mitti_completed: true, mitti_raw_snapshot: null, mitti_synced_at: "2026-10-06T00:00:00.000Z", mitti_modified_at: null },
      { id: "as2", job_id: "j2", external_mitti_id: "m2", mitti_completed: true, mitti_raw_snapshot: null, mitti_synced_at: "2026-10-06T00:00:00.000Z", mitti_modified_at: null },
    ],
    piesa_records: [
      { id: "pr1", job_id: "j1", kind: "initial", external_mitti_id: "m1", created_at: "2026-10-06T00:00:00.000Z", is_current: false },
      { id: "pr2", job_id: "j1", kind: "reassessment", external_mitti_id: null, created_at: "2026-10-26T00:00:00.000Z", is_current: true },
    ],
    workflow_events: [
      { id: "ev1", job_id: "j1", event_type: "electrician_form_approved", details: { kind: "assessment" }, created_at: "2026-10-07T00:00:00.000Z" },
      { id: "ev2", job_id: "j1", event_type: "payout_marked_paid", details: { kind: "assessment", reference: "EFT 1" }, created_at: "2026-10-15T00:00:00.000Z" },
      { id: "ev3", job_id: "j2", event_type: "payout_marked_paid", details: { kind: "assessment", reference: "EFT 2" }, created_at: "2026-10-15T00:00:00.000Z" },
    ],
    quotes: [], quote_internals: [], invoices: [], installer_declarations: [],
    pricing_settings: [{ id: "ps", piesa_rec_cost_ex_gst: 300, gst_rate: 0.1, is_active: true }],
    electrician_rates: [],
  });
}
beforeEach(seed);

describe("office Payouts after a reopen (real moneyPayouts, in-memory database)", () => {
  const lines = async () => { const r = await moneyPayouts(); return [...r.due.flatMap((g) => g.jobs.map((j) => ({ ...j, business: g.business, paid: false }))), ...r.paid.flatMap((g) => g.jobs.map((j) => ({ ...j, business: g.business, paid: true }))), ...r.held.map((h) => ({ jobId: h.jobId, kind: h.kind, visitId: h.visitId, business: h.business, paid: false, reasons: h.reasons }))]; };

  test("two completed visits by two electricians, the first marked paid → the second shows unpaid, for the new electrician", async () => {
    const mine = (await lines()).filter((l) => l.jobId === "j1" && l.kind === "assessment");
    expect(mine).toHaveLength(2);
    expect(mine.find((l) => l.visitId === "v1")).toMatchObject({ business: "Old Sparks", paid: true });
    const second = mine.find((l) => l.visitId === "v2")!;
    expect(second).toMatchObject({ business: "New Sparks", paid: false });
    // The new check was entered on the portal: no Mitti form of its own → held (decision 318), not the old form's pass.
    expect((second as { reasons?: string[] }).reasons).toContain(PAYOUT_FORM_NOT_COMPLETE.assessment);
  });

  test("a payment naming the second visit pays it, and only it", async () => {
    tables["workflow_events"]!.push({ id: "ev4", job_id: "j1", event_type: "payout_marked_paid", details: { kind: "assessment", booking_id: "v2", reference: "EFT 3" }, created_at: "2026-10-28T00:00:00.000Z" });
    const mine = (await lines()).filter((l) => l.jobId === "j1" && l.kind === "assessment");
    expect(mine.map((l) => [l.visitId, l.paid])).toEqual(expect.arrayContaining([["v1", true], ["v2", true]]));
  });

  test("legacy paid event still marks the single-visit job paid", async () => {
    const mine = (await lines()).filter((l) => l.jobId === "j2" && l.kind === "assessment");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ visitId: "w1", business: "Old Sparks", paid: true });
  });
});

describe("the paid event names its visit; the trade's own Money screen and Approve use the same visit rule", () => {
  test("Mark paid and Approve take the visit and record it (office Payouts sends it)", () => {
    const fns = readFileSync("src/lib/office.functions.ts", "utf8");
    expect(fns).toContain("bookingId: z.string().uuid().optional()");
    expect(fns).toContain("booking_id: data.bookingId");
    const ui = readFileSync("src/routes/_authenticated/admin.money.tsx", "utf8");
    expect(ui).toContain("bookingId: j.visitId");
    expect(ui).toContain("bookingId: h.visitId");
  });
  test("the electrician's Money screen matches payments to their own visit", () => {
    const tv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(tv).toContain("safetyVisitPaidAt(");
    expect(tv).toContain("visitGateFacts(");
  });
});
