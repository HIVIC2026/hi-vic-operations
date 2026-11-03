// Saved spots by area, Task 3: Send any saved spot. batchCandidates no longer refuses a home because its answers
// "don't look likely eligible yet"; every other refusal (opt-out, open batch, ...) stays. In-memory fake database.
import { describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  jobs: [], lead_campaign_responses: [], property_facts: [], job_assignments: [], partner_offers: [], workflow_events: [],
};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const fakeAdmin = {
  from(table: string) {
    const preds: ((r: Row) => boolean)[] = [];
    const b: Record<string, unknown> & PromiseLike<unknown> = {
      select() { return b; },
      eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
      in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
      is(c: string, v: unknown) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
      order() { return b; }, range() { return b; },
      then(res, rej) { return Promise.resolve({ data: (tables[table] ?? []).filter((r) => preds.every((p) => p(r))), error: null }).then(res, rej); },
    };
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/lib/property-coordinates.server", () => ({ ensurePropertyCoordinates: async () => null }));

const S = await import("../src/lib/area-batch.server");
const NOW = new Date("2026-10-30T01:00:00.000Z");

function addJob(id: string, o: { optedOut?: boolean; answers?: Row; declared?: Row } = {}) {
  const prop = `p-${id}`;
  tables["jobs"]!.push({
    id, job_number: `HV-${id}`, stage: "ready_check_ready_to_schedule", source: "website", channel: "hivic_sourced", deleted_at: null, qa_archived_at: null,
    property_id: prop, created_at: "2026-10-01T00:00:00Z", owners: { full_name: `Owner ${id}`, phone: "0400000000", email: null },
    properties: { address_line: "1 Sample Street", suburb: "Melbourne", postcode: "3000", declared: o.declared ?? { property_type: "house", over_five_years: "yes" }, answers: o.answers ?? { insulation: "none" } },
  });
  tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: "2026-10-29T00:00:00Z", opted_out_at: o.optedOut ? "2026-10-29T05:00:00Z" : null, saved_insulation: null });
  tables["property_facts"]!.push({ property_id: prop, fact_key: "coordinates", value: [145, -37.8], is_current: true });
}

describe("batchCandidates: any saved spot can be sent", () => {
  test("insulation present with no detail is a candidate; opted-out and open-batch spots are still refused", async () => {
    addJob("present", { answers: { insulation: "yes" } });
    addJob("flat-unit", { declared: { property_type: "apartment", over_five_years: "no" }, answers: { insulation: "yes", insulation_thickness: "thicker" } });
    addJob("optout", { optedOut: true });
    addJob("inbatch");
    tables["workflow_events"]!.push({ job_id: "inbatch", event_type: "area_batch_sent", created_at: "2026-10-29T00:00:00Z", details: { batch_id: "b1" } });
    const r = await S.batchCandidates({ jobIds: ["present", "flat-unit", "optout", "inbatch"], requireLocation: false, now: NOW });
    expect(r.candidates.map((c) => c.jobId).sort()).toEqual(["flat-unit", "present"]);
    expect(r.refused.get("optout")).toBe("the owner hasn't saved a spot");
    expect(r.refused.get("inbatch")).toBe("it's already in a batch waiting for answers");
  });
});
