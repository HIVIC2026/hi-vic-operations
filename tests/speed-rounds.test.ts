// Portal speed step 2 (spec 2026-11-05): the database round counter (tests/helpers/round-counter.ts) and the per-screen
// round budget. A round = the set of queries started before the first of them resolves; queries awaited together share a
// round, queries awaited one after another add rounds. Screen loaders are measured in their own *-waves / *-speed files
// (bun shares mock.module across files in one process, so each screen's fixture runs alone); this file pins the counter.
import { describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { makeCounterDb, officeTables } from "./helpers/query-counter-db";
import { ROUND_LIMIT, roundCounter } from "./helpers/round-counter";

// Office screens are measured on the synthetic office (tests/helpers/query-counter-db.ts, writes refused) behind the
// round counter, installed in place of supabaseAdmin. SPEED_BASELINE=1 prints every screen's rounds and queries.
const N = 300;
// The saved copies the office lists open from (decisions 382/383), fresh, so the served path is the everyday first draw.
const at = new Date().toISOString();
const copies = [
  { key: "live", payload: { groups: [], total: 0 }, computed_at: at, refreshing_at: null },
  { key: "jobs_ours:first", payload: { rows: [], page: 1, totalPages: 1, total: 0, pageSize: 50, all: 0, nextSteps: [], installers: [] }, computed_at: at, refreshing_at: null },
  { key: "enquiries:first", payload: { rows: [], page: 1, totalPages: 1, total: 0, pageSize: 50, counts: { open: 0, incompleteAddresses: 0 } }, computed_at: at, refreshing_at: null },
];
const fresh = () => makeCounterDb({ ...officeTables(N), office_needs_snapshot: copies }, { rtt: 0, perRow: 0, maxIn: 200 });
let db = fresh();
const office = roundCounter({ from: (t: string) => db.client.from(t), rpc: (n: string, a?: unknown) => db.client.rpc(n, a), storage: { from: (b: string) => db.client.storage.from(b) } });
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: office.client }));
const LIVE_JOB = "00000000-0000-4000-8000-000000000002"; // a live job in officeTables (quote_sent)
async function measure<T>(name: string, f: () => Promise<T>) {
  db = fresh();
  await f().catch(() => undefined); // warm the module cache so first module loads never split a round
  db = fresh();
  const r = await office.countRounds(f);
  if (process.env["SPEED_BASELINE"]) console.log(`BASELINE ${name}: rounds=${r.rounds} queries=${r.queries}${process.env["SPEED_ROUNDS"] ? `\n${office.roundsOf(r.log)}` : ""}`);
  expect(db.stats.writes).toEqual([]);
  return r;
}

const tables: Tables = { jobs: [{ id: "j1", stage: "quote_sent" }, { id: "j2", stage: "complete" }], owners: [{ id: "o1" }] };

describe("round counter", () => {
  const rc = roundCounter(memoryPostgrest(tables));
  const q = () => rc.client.from("jobs").select("id, stage");

  test("queries awaited together are one round", async () => {
    const r = await rc.countRounds(() => Promise.all([q(), q()]));
    expect(r).toMatchObject({ rounds: 1, queries: 2 });
    expect(r.result[0].data).toHaveLength(2);
  });

  test("queries awaited one after another add rounds", async () => {
    const r = await rc.countRounds(async () => { await q(); await q(); });
    expect(r).toMatchObject({ rounds: 2, queries: 2 });
  });

  test("a read that depends on an earlier result is a new round; filters and single() still work", async () => {
    const r = await rc.countRounds(async () => {
      const { data } = await rc.client.from("jobs").select("id").eq("stage", "complete").maybeSingle();
      return Promise.all([rc.client.from("owners").select("id"), rc.client.from("jobs").select("stage").eq("id", data!.id)]);
    });
    expect(r).toMatchObject({ rounds: 2, queries: 3 });
    expect(r.result[1].data).toEqual([{ stage: "complete" }]);
  });

  test("a second client wrapped by the same counter shares the count (user clients)", async () => {
    const user = rc.wrap(memoryPostgrest(tables));
    const r = await rc.countRounds(() => Promise.all([q(), user.from("owners").select("id")]));
    expect(r).toMatchObject({ rounds: 1, queries: 2 });
  });

  test("no queries = no rounds; the log names each round's tables", async () => {
    expect(await rc.countRounds(async () => 1)).toMatchObject({ result: 1, rounds: 0, queries: 0 });
    const r = await rc.countRounds(async () => { await q(); await rc.client.from("owners").select("id"); });
    expect(rc.roundsOf(r.log)).toBe("1: jobs\n2: owners");
  });

  test("the budget is three rounds", () => expect(ROUND_LIMIT).toBe(3));
});

describe("office screens (synthetic office; budgets pinned per screen as each task lands)", () => {
  test("office job page (loadJobPage) loads", async () => {
    const { loadJobPage } = await import("@/lib/office-job-page.server");
    const r = await measure("loadJobPage", () => loadJobPage(LIVE_JOB));
    expect(r.result.header.jobId).toBe(LIVE_JOB);
  }, 60_000);
  test("office job page Money card (loadJobMoney) loads", async () => {
    const { loadJobMoney } = await import("@/lib/office-job-page.server");
    await measure("loadJobMoney", () => loadJobMoney(LIVE_JOB));
  }, 60_000);
  test("Needs me: saved copy and the full work-out", async () => {
    const { getNeedsMeSnapshot } = await import("@/lib/office-needs-snapshot.server");
    const { loadNeedsMePage } = await import("@/lib/office-needs.server");
    await measure("Needs me (served from the saved copy)", () => getNeedsMeSnapshot(false));
    await measure("Needs me (loadNeedsMePage)", () => loadNeedsMePage(false));
  }, 120_000);
  test("Enquiries and Active jobs: saved copy path and the full work-out", async () => {
    const snap = await import("@/lib/office-needs-snapshot.server");
    const lists = await import("@/lib/office-lists.server");
    const jobs = { lane: "ours" as const, search: "", sort: "", dir: "desc" as const, page: 1, filters: {}, needsUs: false, includeTest: false };
    await measure("Enquiries (loadEnquiriesList)", () => lists.loadEnquiriesList({ search: "", sort: "", dir: "asc", page: 1, filters: {} }));
    await measure("Active jobs (loadActiveJobsList)", () => lists.loadActiveJobsList(jobs));
    await measure("Active jobs (served from the saved copy)", () => snap.getActiveJobsListServed(jobs));
    await measure("Jobs lane counts (loadJobsLaneCounts)", () => lists.loadJobsLaneCounts());
    await measure("Enquiries (served from the saved copy)", () => snap.getEnquiriesListServed({ search: "", sort: "", dir: "asc", page: 1, filters: {} }));
  }, 120_000);
  test("Choose installer (loadInstallerWaitingList, installerFacts)", async () => {
    const w = await import("@/lib/installer-waiting.server");
    await measure("Choose installer list", () => w.loadInstallerWaitingList({ includeTest: false }));
    await measure("Choose installer installerFacts", () => w.installerFacts());
  }, 60_000);
});
