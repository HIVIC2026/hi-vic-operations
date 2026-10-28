// Decision 382: Needs me opens from a saved copy refreshed in the background. Pure plan + wiring + practice-database proof.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LIST_SNAPSHOT_KEYS, NEEDS_FRESH_MS, NEEDS_MAX_SERVE_MS, checkedLabel, isDefaultListView, listSnapshotPlan, needsSnapshotKey, needsSnapshotPlan } from "../src/lib/office-needs-snapshot.core";
import { markOfficeChanged, readOfficeList } from "../src/lib/office-list-refresh";

describe("decision 382: Needs me saved copy", () => {
  test("plan: none/too old → work it out now; fresh → serve; older or after an action → serve and refresh", () => {
    expect(needsSnapshotPlan(null)).toBe("compute_now");
    expect(needsSnapshotPlan(NEEDS_MAX_SERVE_MS + 1)).toBe("compute_now");
    expect(needsSnapshotPlan(-5)).toBe("compute_now");
    expect(needsSnapshotPlan(10_000)).toBe("serve");
    expect(needsSnapshotPlan(10_000, true)).toBe("serve_and_refresh");
    expect(needsSnapshotPlan(NEEDS_FRESH_MS + 1)).toBe("serve_and_refresh");
    expect(needsSnapshotKey(false)).toBe("live");
    expect(needsSnapshotKey(true)).toBe("test");
  });
  test("checked label", () => {
    const now = Date.parse("2026-10-25T10:00:00Z");
    expect(checkedLabel("2026-10-25T09:59:30Z", false, now)).toBe("just now");
    expect(checkedLabel("2026-10-25T09:56:00Z", true, now)).toBe("4 min ago · updating…");
  });
  test("wired: server fn, page, tick", () => {
    expect(readFileSync("src/lib/office-screens.functions.ts", "utf8")).toContain("getNeedsMeSnapshot(data.includeTest, data.refresh)");
    expect(readFileSync("src/routes/_authenticated/admin.needs-me.tsx", "utf8")).toContain("q.state.data?.refreshing ? 5_000");
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("refreshNeedsMeSnapshot()");
  });
  test("decision 383: only the opening view of Jobs › Active / Enquiries has a saved copy", () => {
    const v = { search: "", sort: "", page: 1, filters: {} };
    expect(isDefaultListView(v)).toBe(true);
    expect(isDefaultListView({ ...v, filters: { stage: [], installer: [], suburb: "", ownJobs: false, size: { min: undefined, max: undefined } } })).toBe(true);
    expect(isDefaultListView({ ...v, search: "smith" })).toBe(false);
    expect(isDefaultListView({ ...v, sort: "heard" })).toBe(false);
    expect(isDefaultListView({ ...v, page: 2 })).toBe(false);
    expect(isDefaultListView({ ...v, includeTest: true })).toBe(false);
    expect(isDefaultListView({ ...v, filters: { stage: ["quote"] } })).toBe(false);
    expect(isDefaultListView({ ...v, filters: { owner: " " } })).toBe(false);
    expect(isDefaultListView({ ...v, filters: { ownJobs: true } })).toBe(false);
    expect(isDefaultListView({ ...v, filters: { size: { min: 100 } } })).toBe(false);
    // After an office action the list is worked out now, never served from the older copy.
    expect(listSnapshotPlan(10_000, true)).toBe("compute_now");
    expect(listSnapshotPlan(10_000)).toBe("serve");
    expect(listSnapshotPlan(NEEDS_FRESH_MS + 1)).toBe("serve_and_refresh");
    expect(listSnapshotPlan(null)).toBe("compute_now");
    expect(LIST_SNAPSHOT_KEYS).toEqual({ jobsOurs: "jobs_ours:first", jobsInstaller: "jobs_installer:first", enquiries: "enquiries:first" });
  });
  test("decision 383: after a change in this tab the opening view asks for a fresh page until one comes back", async () => {
    const asked: boolean[] = [];
    const read = (list: "jobs" | "enquiries", opening = true) => readOfficeList(list, opening, async (r) => { asked.push(r); return r; });
    await read("jobs");
    markOfficeChanged();
    await read("jobs", false); // a filtered (live) view never consumes the change
    await Promise.all([read("jobs"), read("jobs")]); // overlapping reads (an invalidation cancelling another) both refresh
    await read("jobs");
    await read("enquiries");
    await read("enquiries");
    expect(asked).toEqual([false, false, true, true, false, true, false]);
  });
  test("decision 383 wired: server fns, screens, tick, useAction", () => {
    const fns = readFileSync("src/lib/office-screens.functions.ts", "utf8");
    expect(fns).toContain("getActiveJobsListServed(params as JobsListParams, refresh)");
    expect(fns).toContain("getEnquiriesListServed(params, refresh)");
    expect(readFileSync("src/components/portal/JobsScreen.tsx", "utf8")).toContain('readOfficeList("jobs"');
    expect(readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8")).toContain('readOfficeList("enquiries"');
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("refreshListSnapshots()");
    expect(readFileSync("src/hooks/use-me.ts", "utf8")).toContain("markOfficeChanged()");
  });
  test("practice database: table applies, closed to the browser, one refresher, undoes", async () => {
    const p = Bun.spawnSync(["bun", "tests/helpers/pglite-office-needs-snapshot.ts"]);
    expect(p.stdout.toString()).toContain("PASS");
  }, 60_000);
});
