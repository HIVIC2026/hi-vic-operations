import { beforeEach, expect, mock, test } from "bun:test";
let liveAt: string | null = "2026-11-06T00:00:00Z";
let tables: Record<string, Record<string, any>[]> = {};
const reads: string[] = [];
function from(table: string) {
  reads.push(table);
  const filters: ((r: Record<string, any>) => boolean)[] = [];
  let range = [0, 9999], single = false;
  const q: any = {
    select: () => q, order: () => q,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    gte: (k: string, v: string) => { filters.push(r => r[k] >= v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    not: (k: string, op: string, v: unknown) => { filters.push(r => op === "is" ? r[k] != null : op === "in" ? !String(v).slice(1,-1).split(",").includes(r[k]) : r[k] !== v); return q; },
    range: (a: number, b: number) => { range = [a,b]; return q; },
    limit: (n: number) => { range = [0,n-1]; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve: (v: unknown) => unknown) => { const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(range[0],range[1]+1); return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve); },
  };
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/office.server", () => ({ loadOffice: async () => ({}) }));
mock.module("../src/lib/firm-quote.server", () => ({ firmQuoteLiveAt: async () => liveAt }));
mock.module("../src/lib/auto-offer.server", () => ({ readAutoOfferSwitches: async () => ({}) }));
const { loadEnquiriesList } = await import("../src/lib/office-lists.server");
const params = { view: "all" as const, search: "", sort: "", dir: "asc" as const, page: 1, filters: {} };
beforeEach(() => {
  reads.length = 0; liveAt = "2026-11-06T00:00:00Z";
  const rows = [
    { id: "fresh", office_bucket: "enquiry", stage: "new_enquiry", created_at: "2026-11-06T01:00:00Z" },
    { id: "asked", office_bucket: "active", stage: "ready_check_ready_to_schedule", created_at: "2026-11-06T02:00:00Z", spot_saved: true, owner_progressed: false },
    { id: "old", office_bucket: "enquiry", stage: "new_enquiry", created_at: "2026-11-05T01:00:00Z" },
    { id: "closed", office_bucket: "closed", stage: "cancelled", created_at: "2026-11-06T02:00:00Z" },
    { id: "given", office_bucket: "active", stage: "ready_check_ready_to_schedule", created_at: "2026-11-06T02:00:00Z", spot_saved: true, owner_progressed: false },
    { id: "quoted", office_bucket: "active", stage: "ready_check_ready_to_schedule", created_at: "2026-11-06T02:00:00Z", spot_saved: true, owner_progressed: false },
  ].map(r => ({ ...r, source: "base44", channel: "hivic_sourced", job_number: r.id, owner_name: "TEST Owner", owner_phone: null, owner_email: null }));
  tables = {
    office_enquiry_index: rows, jobs: rows.map(r => ({ ...r, estimated_area_m2: 120, properties: { address_line: "1 TEST Street", suburb: "TEST", postcode: "3000", answers: { existing_insulation: "No" } } })),
    documents: rows.map(r => ({ job_id: r.id, kind: "intake_media", mime_type: "image/jpeg", storage_path: `${r.id}/intake/photo.jpg` })),
    workflow_events: ["asked", "given", "quoted"].map(id => ({ job_id: id, event_type: "firm_quote_requested", details: { due_by: "2026-11-17" } })),
    job_assignments: [{ job_id: "given", role: "installer", active: true }],
    quotes: [{ job_id: "quoted", kind: "installation", status: "draft" }],
  };
});
test("new and requested firm enquiries are read once; saved due date survives Proceed", async () => {
  const result = await loadEnquiriesList(params);
  expect(result.rows.map(r => r.id).sort()).toEqual(["asked", "fresh", "old"]);
  expect(result.rows.find(r => r.id === "asked")?.firmQuoteDueBy).toBe("2026-11-17");
  expect(result.rows.find(r => r.id === "fresh")?.firmQuoteDueBy).toBeNull();
  expect(result.counts.byCategory.with_photos).toBe(2);
  expect(result.counts.byCategory.not_sent).toBe(1);
  expect(result.counts.byCategory.all).toBe(3);
});
test("With photos paging and ids share the same membership; other tabs exclude firm jobs", async () => {
  const photos = await loadEnquiriesList({ ...params, view: "with_photos", wantIds: true });
  expect(photos.ids?.sort()).toEqual(["asked", "fresh"]);
  expect(photos.total).toBe(2);
  const old = await loadEnquiriesList({ ...params, view: "not_sent" });
  expect(old.rows.map(r => r.id)).toEqual(["old"]);
});
test("opted-out firm enquiry uses Opted out; closed and allocated/quoted requests stay out", async () => {
  tables.customer_email_optouts = [{ job_id: "fresh", opted_out_at: "2026-11-06T03:00:00Z" }];
  const result = await loadEnquiriesList(params);
  expect(result.rows.find(r => r.id === "fresh")?.category).toBe("opted_out");
  expect(result.counts.byCategory.opted_out).toBe(1);
});
test("null switch leaves existing scope and categories unchanged without media/request reads", async () => {
  liveAt = null;
  const result = await loadEnquiriesList(params);
  expect(result.rows.map(r => r.id).sort()).toEqual(["fresh", "old"]);
  expect(result.rows.every(r => r.category === "not_sent")).toBe(true);
  expect(reads).not.toContain("documents");
  expect(result.counts.byCategory.with_photos).toBe(0);
});