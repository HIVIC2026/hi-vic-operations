// Task 9 fix round 1 (IMPORTANT 3): the real Active-jobs loader decides "Waiting on the electrician's price" from the job's
// stage, its fixes quote, the CURRENT A3 form and the price events. Real loadOffice over an in-memory PostgREST.
// Run on its own: bun test tests/repair-price-wait-office.test.ts
import { describe, expect, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { loadOffice } from "../src/lib/office.server";
import { A3_REPAIR_NEEDED_LABEL, FIXES_PRICE_LABEL, FIXES_WORK_LABEL, FIXES_WORK_OPTIONS } from "../src/lib/official-short.core";

const JOB = "00000000-0000-4000-8000-000000000b01";
const AUDIT = "audit-a3-1";
const NOTICE = "Waiting on the electrician's price";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const form = (price: string | null) => [{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }, { label: FIXES_WORK_LABEL, value: FIXES_WORK_OPTIONS[2] }, ...(price == null ? [] : [{ label: FIXES_PRICE_LABEL, value: price }])];

type Opt = { stage?: string; quote?: Record<string, unknown> | null; audit?: string; formPrice?: string | null; portalPrice?: boolean; linkAudit?: string; linkHoursAgo?: number };
function tables(o: Opt = {}): Tables {
  const events: Record<string, unknown>[] = [{ id: "l1", job_id: JOB, event_type: "repair_price_link_sent", details: { key: "k", audit_id: o.linkAudit ?? AUDIT }, created_at: hoursAgo(o.linkHoursAgo ?? 25) }];
  if (o.portalPrice) events.push({ id: "p1", job_id: JOB, event_type: "electrician_repair_price_set", details: { audit_id: o.linkAudit ?? AUDIT, price_inc_gst: 1800 }, created_at: hoursAgo(2) });
  return {
    jobs: [{ id: JOB, job_number: "HV-9B01", stage: o.stage ?? "piesa_complete", source: "portal", channel: "hivic_sourced", deleted_at: null, qa_archived_at: null, created_at: hoursAgo(100), last_activity_at: hoursAgo(30), owners: { full_name: "Pat" }, properties: { suburb: "Frankston", postcode: "3199" } }],
    assessments: [{ id: "as1", job_id: JOB, external_mitti_id: o.audit ?? AUDIT, mitti_completed: true, mitti_raw_snapshot: form(o.formPrice ?? null) }],
    quotes: o.quote === null ? [] : [{ id: "q1", job_id: JOB, kind: "rectification", status: "draft", release_state: "held", release_hold_reason: null, sent_at: null, accepted_at: null, created_at: hoursAgo(10), ...(o.quote ?? {}) }],
    workflow_events: events,
    workflow_settings: [{ id: 1 }],
  };
}
const detail = async (o: Opt) => {
  const T = tables(o);
  const admin = { from: (t: string) => memoryPostgrest(T).from(t) } as never;
  const out = await loadOffice(admin, { onlyIds: [JOB], statusOnly: true, includeTest: true });
  return out.jobs.find((j: { id: string }) => j.id === JOB) as { status: { detail: string | null } | null } | undefined;
};

describe("Active jobs: waiting on the electrician's price", () => {
  test("25h unpriced on the current form, quote still a draft -> the alert", async () => {
    expect((await detail({}))?.status?.detail ?? "").toContain(NOTICE);
  });
  test("quote sent -> no alert", async () => {
    expect((await detail({ quote: { status: "issued", sent_at: hoursAgo(3) } }))?.status?.detail ?? "").not.toContain(NOTICE);
  });
  test("job moved on / cancelled -> no alert", async () => {
    for (const stage of ["installation_booked", "cancelled", "complete"]) expect((await detail({ stage }))?.status?.detail ?? "", stage).not.toContain(NOTICE);
  });
  test("re-sync where the form now carries a price -> no alert", async () => {
    expect((await detail({ formPrice: "1,200" }))?.status?.detail ?? "").not.toContain(NOTICE);
  });
  test("portal price entered -> no alert", async () => {
    expect((await detail({ portalPrice: true }))?.status?.detail ?? "").not.toContain(NOTICE);
  });
  test("redone check (a new form) with a priced form -> no alert; the old form's link alone doesn't alert either", async () => {
    expect((await detail({ audit: "audit-new", linkAudit: "audit-new", formPrice: "1,200" }))?.status?.detail ?? "").not.toContain(NOTICE);
    expect((await detail({ audit: "audit-new", linkAudit: AUDIT }))?.status?.detail ?? "").not.toContain(NOTICE);
  });
  test("23h after the link -> no alert yet", async () => {
    expect((await detail({ linkHoursAgo: 23 }))?.status?.detail ?? "").not.toContain(NOTICE);
  });
});
