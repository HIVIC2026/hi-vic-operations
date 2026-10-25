// Round-trip budget for the office home screens (Needs me, Jobs › Active, Enquiries) on a synthetic office of 2,200
// jobs (a quarter live). Counts every database request and the sequential "waves" (an idle→busy transition = one
// more round trip the user waits for). Run with PERF_REPORT=1 to print the per-table breakdown.
import { describe, expect, mock, test } from "bun:test";
import { makeCounterDb, officeTables } from "./helpers/query-counter-db";

const N = Number(process.env["PERF_JOBS"] ?? 2200);
let current = makeCounterDb(officeTables(N), { rtt: Number(process.env["PERF_RTT"] ?? 5), perRow: process.env["PERF_RTT"] ? 0 : 0.001, maxIn: 200 });
const proxy = { from: (t: string) => current.client.from(t), rpc: (n: string, a?: unknown) => current.client.rpc(n, a), storage: { from: (b: string) => current.client.storage.from(b) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: proxy }));
const fresh = () => { current = makeCounterDb(officeTables(N), { rtt: Number(process.env["PERF_RTT"] ?? 5), perRow: process.env["PERF_RTT"] ? 0 : 0.001, maxIn: 200 }); return current; };
const report = (name: string, ms: number) => {
  const s = current.stats;
  if (process.env["PERF_REPORT"]) {
    const top = Object.entries(s.byTable).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t, c]) => `${t}=${c}`).join(" ");
    if (process.env["PERF_TRACE"]) { const m = new Map<string, number>(); for (const q of s.log) m.set(`${q.table} @ ${q.site}`, (m.get(`${q.table} @ ${q.site}`) ?? 0) + 1); console.log([...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `   ${v}× ${k}`).join("\n")); }
    console.log(`${name}: requests=${s.requests} waves=${s.waves} rows=${s.rows} maxInFlight=${s.maxInFlight} ms=${ms}\n  ${top}`);
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
    // Baseline 157 requests in 34 sequential waves (one loadOffice per 150 jobs, one after another); after: one loadOffice.
    expect(s.requests).toBeLessThan(130);
    expect(s.waves).toBeLessThan(10);
  }, 120_000);
  test("Enquiries", async () => {
    fresh();
    const { loadEnquiriesList } = await import("@/lib/office-lists.server");
    const t = Date.now(); await loadEnquiriesList({ search: "", sort: "", dir: "asc", page: 1, filters: {} }); const s = report("enquiries", Date.now() - t);
    expect(s.writes).toEqual([]);
  }, 120_000);
});
