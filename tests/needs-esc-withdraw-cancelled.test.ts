// Fix wave J5 (controller ruling, 4 Nov 2026): the legacy Needs queue / daily brief must raise the "withdraw the ESC notice"
// item for a CANCELLED job too — the ask is exactly about a job that won't go ahead. loadNeedsHivic's jobs read leaves
// cancelled/complete jobs out, so those jobs are read for this item only; every other item on a cancelled job stays out.
import { describe, expect, mock, test } from "bun:test";
import { memoryPostgrest } from "./helpers/memory-postgrest";

const ASK_AT = "2026-11-03T01:00:00Z";
const rows = {
  jobs: [
    { id: "j-open", job_number: "HV-1", source: "website", stage: "installation_booked", channel: "hivic_sourced", deleted_at: null, properties: [] },
    { id: "j-cancelled", job_number: "HV-2", source: "website", stage: "cancelled", channel: "hivic_sourced", deleted_at: null, properties: [] },
    { id: "j-test-cancelled", job_number: "HV-3", source: "qa_test", stage: "cancelled", channel: "hivic_sourced", deleted_at: null, properties: [] },
  ],
  workflow_events: [
    { id: "e1", job_id: "j-cancelled", event_type: "esc_withdraw_required", created_at: ASK_AT, details: { notification_id: "n1", reference: "VEU-123", reason: "owner_cancelled", needs_office: true }, summary: "withdraw" },
    { id: "e2", job_id: "j-test-cancelled", event_type: "esc_withdraw_required", created_at: ASK_AT, details: { notification_id: "n2", reference: "VEU-999", reason: "owner_cancelled", needs_office: true }, summary: "withdraw" },
    // another item kind on the cancelled job: must NOT surface (closed job)
    { id: "e3", job_id: "j-cancelled", event_type: "mitti_access_needed", created_at: ASK_AT, details: {}, summary: "Mitti access needed" },
  ],
  office_enquiry_index: [{ id: "j-cancelled", office_bucket: "closed" }, { id: "j-test-cancelled", office_bucket: "closed" }],
};
const client = memoryPostgrest(rows as never);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));
mock.module("../src/lib/prestart.server", () => ({ prestartNeeds: async () => [] }));
mock.module("../src/lib/offer-dispatch.server", () => ({ offerSuggestHours: async () => 24, dispatchMode: async () => "office_picks" }));
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async () => new Map() }));

describe("Needs queue: ESC withdrawal ask on a cancelled job", () => {
  test("the cancelled job's esc_withdraw_required row is raised (not a TEST job's); its other items stay out; open jobs unchanged", async () => {
    const { loadNeedsHivic } = await import("../src/lib/needs.server");
    const { items } = await loadNeedsHivic();
    const esc = items.filter((i) => i.code === "esc_withdraw_required");
    expect(esc.map((i) => [i.jobId, i.jobNumber])).toEqual([["j-cancelled", "HV-2"]]);
    expect(esc[0]!.why).toContain("Registry ref VEU-123.");
    expect(esc[0]!.stage).toBe("cancelled");
    expect(items.filter((i) => i.jobId === "j-cancelled").map((i) => i.code)).toEqual(["esc_withdraw_required"]);
    expect(items.some((i) => i.jobId === "j-test-cancelled")).toBe(false);
  });
});
