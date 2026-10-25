// Decision 382: Needs me opens from a saved copy refreshed in the background. Pure plan + wiring + practice-database proof.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NEEDS_FRESH_MS, NEEDS_MAX_SERVE_MS, checkedLabel, needsSnapshotKey, needsSnapshotPlan } from "../src/lib/office-needs-snapshot.core";

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
  test("practice database: table applies, closed to the browser, one refresher, undoes", async () => {
    const p = Bun.spawnSync(["bun", "tests/helpers/pglite-office-needs-snapshot.ts"]);
    expect(p.stdout.toString()).toContain("PASS");
  }, 60_000);
});
