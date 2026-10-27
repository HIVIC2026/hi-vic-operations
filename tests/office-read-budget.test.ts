// Round-trip budget for the office home screens (Needs me, Jobs › Active, Enquiries) on a synthetic office of 2,200
// jobs (a quarter live). Counts every database request and the sequential "waves" (an idle→busy transition = one
// more round trip the user waits for). Run with PERF_REPORT=1 to print the per-table breakdown.
import { describe, expect, mock, test } from "bun:test";
import { makeCounterDb, officeTables } from "./helpers/query-counter-db";

const N = Number(process.env["PERF_JOBS"] ?? 2200);
let current = makeCounterDb(officeTables(N), { rtt: Number(process.env["PERF_RTT"] ?? 5), perRow: process.env["PERF_RTT"] ? 0 : 0.001, maxIn: 200, conn: Number(process.env["PERF_CONN"] ?? Infinity) });
const proxy = { from: (t: string) => current.client.from(t), rpc: (n: string, a?: unknown) => current.client.rpc(n, a), storage: { from: (b: string) => current.client.storage.from(b) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: proxy }));
const fresh = () => { current = makeCounterDb(officeTables(N), { rtt: Number(process.env["PERF_RTT"] ?? 5), perRow: process.env["PERF_RTT"] ? 0 : 0.001, maxIn: 200, conn: Number(process.env["PERF_CONN"] ?? Infinity) }); return current; };
const report = (name: string, ms: number) => {
  const s = current.stats;
  if (process.env["PERF_REPORT"]) {
    const top = Object.entries(s.byTable).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t, c]) => `${t}=${c}`).join(" ");
    if (process.env["PERF_TRACE"]) { const m = new Map<string, number>(); for (const q of s.log) m.set(`${q.table} @ ${q.site}`, (m.get(`${q.table} @ ${q.site}`) ?? 0) + 1); console.log([...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `   ${v}× ${k}`).join("\n")); }
    console.log(`${name}: requests=${s.requests} waves=${s.waves} depth=${s.depth} rows=${s.rows} maxInFlight=${s.maxInFlight} ms=${ms}\n  ${top}`);
  }
  return s;
};

describe("office read budgets (synthetic, counts only)", () => {
  test("Needs me", async () => {
    fresh();
    const { loadNeedsMePage } = await import("@/lib/office-needs.server");
    const t = Date.now(); await loadNeedsMePage(false); const s = report("needs-me", Date.now() - t);
    expect(s.writes).toEqual([]);
    // Perf 25 Oct 2026 baseline on this office: 833 requests, 33,231 rows, 42 sequential waves (≈5.6 s at 50 ms a trip);
    // after: ≈750 requests (most are Quotes-to-check readiness guards), ≈8,200 rows, ≈1.2 s at 50 ms a trip.
    expect(s.rows).toBeLessThan(12_000);
    expect(s.requests).toBeLessThan(800);
  }, 120_000);
  test("Jobs › Active", async () => {
    fresh();
    const { loadActiveJobsList } = await import("@/lib/office-lists.server");
    const t = Date.now(); await loadActiveJobsList({ search: "", sort: "", dir: "desc", page: 1, filters: {}, includeTest: false }); const s = report("jobs-active", Date.now() - t);
    expect(s.writes).toEqual([]);
    // Baseline 157 requests in 34 sequential waves (one loadOffice per 150 jobs, one after another); then one loadOffice
    // (110 requests, 4 waves). Decision 383: status facts only, for the page shown, in one wave → 38 requests, 3 waves.
    expect(s.requests).toBeLessThanOrEqual(45);
    expect(s.waves).toBeLessThanOrEqual(3);
  }, 120_000);
  test("Jobs › Active with a search (every status line is read)", async () => {
    fresh();
    const { loadActiveJobsList } = await import("@/lib/office-lists.server");
    const t = Date.now(); await loadActiveJobsList({ search: "hv-", sort: "", dir: "desc", page: 1, filters: {}, includeTest: false }); const s = report("jobs-active-search", Date.now() - t);
    expect(s.writes).toEqual([]);
    expect(s.requests).toBeLessThanOrEqual(80);
    expect(s.waves).toBeLessThanOrEqual(3);
  }, 120_000);
  test("Enquiries", async () => {
    fresh();
    const { loadEnquiriesList } = await import("@/lib/office-lists.server");
    const t = Date.now(); await loadEnquiriesList({ search: "", sort: "", dir: "asc", page: 1, filters: {} }); const s = report("enquiries", Date.now() - t);
    expect(s.writes).toEqual([]);
    // Every read feeds the hottest-first order and the groups over all enquiries. Jo 26 Oct 2026: the groups add owner
    // emails and the two opt-out tables in the SAME wave (38 → 53 requests, still 2 waves; the opening view is the
    // saved copy, one request, below).
    expect(s.requests).toBeLessThanOrEqual(55);
    expect(s.waves).toBeLessThanOrEqual(2);
  }, 120_000);
  test("decision 383: opening Jobs › Active / Enquiries from a fresh saved copy = one request, no writes", async () => {
    const at = new Date().toISOString();
    const { getActiveJobsListServed, getEnquiriesListServed } = await import("@/lib/office-needs-snapshot.server");
    // Seed the copies straight into the synthetic table the counter reads.
    current = makeCounterDb({ ...officeTables(N), office_needs_snapshot: [
      { key: "jobs_active:first", payload: { rows: [], page: 1, totalPages: 1, total: 0, pageSize: 50, all: 0, stageCounts: {}, ownCount: 0, installers: [] }, computed_at: at, refreshing_at: null },
      { key: "enquiries:first", payload: { rows: [], page: 1, totalPages: 1, total: 0, pageSize: 50, counts: { open: 0, incompleteAddresses: 0 } }, computed_at: at, refreshing_at: null },
    ] }, { rtt: 5, perRow: 0, maxIn: 200 });
    const j = await getActiveJobsListServed({ search: "", sort: "", dir: "desc", page: 1, filters: {}, includeTest: false });
    expect(j.fromCopy).toBe(true);
    const e = await getEnquiriesListServed({ search: "", sort: "", dir: "asc", page: 1, filters: {} });
    expect(e.fromCopy).toBe(true);
    const s = report("lists-from-copy", 0);
    expect(s.requests).toBe(2); // one per screen
    expect(s.writes).toEqual([]);
  }, 120_000);
  test("decision 383: page-only status lines equal the every-job status lines", async () => {
    fresh();
    const { loadActiveJobsList } = await import("@/lib/office-lists.server");
    const base = { sort: "", dir: "desc" as const, page: 1, filters: {}, includeTest: false };
    const pageOnly = await loadActiveJobsList({ ...base, search: "" });
    const every = await loadActiveJobsList({ ...base, search: "hv-" }); // matches every job number, same order
    expect(every.total).toBe(pageOnly.total);
    expect(pageOnly.rows.map((r) => r.status).filter((x) => x === "")).toEqual([]);
    expect(pageOnly.rows).toEqual(every.rows);
  }, 120_000);
  test("decision 383: loadOffice statusOnly gives the same status as the full read", async () => {
    fresh();
    const { loadOffice } = await import("@/lib/office.server");
    const ids = officeTables(N).office_job_list!.map((r) => String(r["id"]));
    const full = await loadOffice(proxy as never, { includeTest: true, onlyIds: ids });
    const lean = await loadOffice(proxy as never, { includeTest: true, onlyIds: ids, statusOnly: true });
    const key = (o: typeof full) => o.jobs.map((j) => [j.id, j.status?.label ?? null, j.status?.detail ?? null]);
    expect(lean.jobs.length).toBe(full.jobs.length);
    expect(key(lean)).toEqual(key(full));
  }, 120_000);
});
