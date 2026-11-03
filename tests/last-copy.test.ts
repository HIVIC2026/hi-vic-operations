// Speed (portal speed step 1, task 9): the last copy on this device. Storage rules (per user, 24 h, cleared on sign-out,
// both prefixes), the office lists' early start seeding the cache from it, and what gets written (never an error).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";

let fail = false;
const calls: string[] = [];
const fresh = { rows: [{ id: "fresh" }] };
mock.module("@/lib/office-screens.functions", () => ({
  getActiveJobsList: async () => { calls.push("jobs"); if (fail) throw new Error("no"); return fresh; },
  getEnquiriesList: async () => { calls.push("enquiries"); if (fail) throw new Error("no"); return fresh; },
}));
mock.module("@/lib/installer-waiting.functions", () => ({
  getInstallerWaitingList: async () => { calls.push("waiting"); if (fail) throw new Error("no"); return fresh; },
}));

const { clearTradeCache, readLastCopy, writeLastCopy, readTradeCache, writeTradeCache, resetTradeCacheSignOut } = await import("../src/lib/trade-cache");
const { startJobsList, startEnquiriesList, startInstallerWaitingList } = await import("../src/lib/office-route-prefetch");
const { isLastCopy, useRememberLastCopy } = await import("../src/lib/office-last-copy");
const { jobsListKey, enquiriesListKey, installerWaitingKey } = await import("../src/lib/office-list-keys.core");
const { DEFAULT_VIEW } = await import("../src/lib/jobs-columns.core");
const { renderHook } = await import("@testing-library/react");

const tick = () => new Promise((r) => setTimeout(r, 10));
const old = { rows: [{ id: "old" }] };
const keep = (name: string, key: readonly unknown[], data: unknown, uid = "u1") => writeLastCopy(uid, name, { k: JSON.stringify(key), d: data });
const jobsKey = jobsListKey("installer", DEFAULT_VIEW, "", 1);
let qc: QueryClient;
beforeEach(() => { localStorage.clear(); resetTradeCacheSignOut(); calls.length = 0; fail = false; qc = new QueryClient(); });

describe("storage rules", () => {
  test("per user: another user never reads a copy", () => {
    writeLastCopy("u1", "jobs", { a: 1 });
    expect(readLastCopy("u1", "jobs")?.data).toEqual({ a: 1 });
    expect(readLastCopy("u2", "jobs")).toBeNull();
    expect(readLastCopy("", "jobs")).toBeNull();
  });
  test("older than 24 hours is ignored", () => {
    writeLastCopy("u1", "jobs", 1);
    const k = "hiv-last:v1:u1:jobs";
    localStorage.setItem(k, JSON.stringify({ at: Date.now() - 25 * 3600_000, data: 1 }));
    expect(readLastCopy("u1", "jobs")).toBeNull();
  });
  test("sign-out clears every hiv-last and hiv-trade key, and nothing else", () => {
    writeLastCopy("u1", "jobs", 1); writeLastCopy("u2", "enquiries", 2);
    writeTradeCache("u1", "home", 3);
    localStorage.setItem("hiv:jobs:installer", "view");
    clearTradeCache();
    expect(readLastCopy("u1", "jobs")).toBeNull();
    expect(readLastCopy("u2", "enquiries")).toBeNull();
    expect(readTradeCache("u1", "home")).toBeNull();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("hiv:jobs:installer")).toBe("view");
  });
  test("after sign-out a fetch still in flight cannot write the old user's copy back", () => {
    clearTradeCache();
    writeLastCopy("u1", "jobs", 1);
    expect(localStorage.length).toBe(0);
  });
  test("the two kinds do not read each other", () => {
    writeTradeCache("u1", "x", 1);
    expect(readLastCopy("u1", "x")).toBeNull();
  });
});

describe("the list's early start draws from the copy", () => {
  test("Active jobs: the copy is in the cache at once, shown as a last copy, then replaced by the fresh answer", async () => {
    keep("jobs:installer", jobsKey, old);
    startJobsList({ queryClient: qc, user: { id: "u1" } }, "installer", undefined, false);
    expect(qc.getQueryData(jobsKey)).toEqual(old);
    const at = qc.getQueryState(jobsKey)!.dataUpdatedAt;
    expect(isLastCopy(jobsKey, at)).toBe(true);
    await tick();
    expect(calls).toEqual(["jobs"]); // asked again even though the copy is younger than the 30 s freshness
    expect(qc.getQueryData(jobsKey)).toEqual(fresh);
    expect(isLastCopy(jobsKey, qc.getQueryState(jobsKey)!.dataUpdatedAt)).toBe(false);
  });
  test("Enquiries and Choose installer do the same", async () => {
    const ek = enquiriesListKey("offered", "", {}, { k: "", d: "asc" }, 1);
    const wk = installerWaitingKey(false);
    keep("enquiries", ek, old); keep("installer-waiting", wk, old);
    startEnquiriesList({ queryClient: qc, user: { id: "u1" } }, false);
    startInstallerWaitingList({ queryClient: qc, user: { id: "u1" } }, false);
    expect(qc.getQueryData(ek)).toEqual(old);
    expect(qc.getQueryData(wk)).toEqual(old);
    await tick();
    expect(qc.getQueryData(ek)).toEqual(fresh);
    expect(qc.getQueryData(wk)).toEqual(fresh);
  });
  test("a different user, no user, or an old copy: nothing shown, today's behaviour", async () => {
    keep("jobs:installer", jobsKey, old, "u1");
    startJobsList({ queryClient: qc, user: { id: "u2" } }, "installer", undefined, false);
    expect(qc.getQueryData(jobsKey)).toBeUndefined();
    const qc2 = new QueryClient();
    startJobsList({ queryClient: qc2 }, "installer", undefined, false);
    expect(qc2.getQueryData(jobsKey)).toBeUndefined();
    localStorage.setItem("hiv-last:v1:u1:jobs:installer", JSON.stringify({ at: Date.now() - 25 * 3600_000, data: { k: JSON.stringify(jobsKey), d: old } }));
    const qc3 = new QueryClient();
    startJobsList({ queryClient: qc3, user: { id: "u1" } }, "installer", undefined, false);
    expect(qc3.getQueryData(jobsKey)).toBeUndefined();
    await tick();
  });
  test("a copy of a different view (other filters/lane) is not shown", () => {
    keep("jobs:installer", jobsListKey("installer", { ...DEFAULT_VIEW, needsUs: !DEFAULT_VIEW.needsUs }, "", 1), old);
    startJobsList({ queryClient: qc, user: { id: "u1" } }, "installer", undefined, false);
    expect(qc.getQueryData(jobsKey)).toBeUndefined();
  });
  test("a hover preload shows nothing and asks nothing", async () => {
    keep("jobs:installer", jobsKey, old);
    startJobsList({ queryClient: qc, user: { id: "u1" } }, "installer", undefined, true);
    await tick();
    expect(qc.getQueryData(jobsKey)).toBeUndefined();
    expect(calls).toEqual([]);
  });
  test("the fresh call fails: the copy stays on screen, nothing new is stored", async () => {
    keep("jobs:installer", jobsKey, old);
    const before = localStorage.getItem("hiv-last:v1:u1:jobs:installer");
    fail = true;
    startJobsList({ queryClient: qc, user: { id: "u1" } }, "installer", undefined, false);
    await tick();
    expect(qc.getQueryData(jobsKey)).toEqual(old);
    expect(localStorage.getItem("hiv-last:v1:u1:jobs:installer")).toBe(before);
  });
});

describe("what the page keeps for next time", () => {
  const q = (o: Record<string, unknown>) => ({ isSuccess: true, isPlaceholderData: false, data: fresh, dataUpdatedAt: Date.now() + 5, ...o });
  const stored = () => readLastCopy<{ k: string; d: unknown }>("u1", "jobs:installer");
  test("a good fresh answer is kept, under the user and the list's key", () => {
    renderHook(() => useRememberLastCopy("u1", "jobs:installer", true, jobsKey, q({})));
    expect(stored()?.data).toEqual({ k: JSON.stringify(jobsKey), d: fresh });
  });
  test.each([
    ["an error", { isSuccess: false }],
    ["a placeholder (the previous page's rows)", { isPlaceholderData: true }],
    ["no data", { data: undefined }],
  ])("never from %s", (_n, o) => {
    renderHook(() => useRememberLastCopy("u1", "jobs:installer", true, jobsKey, q(o)));
    expect(stored()).toBeNull();
  });
  test("not for a searched or later page, and not without a signed-in user", () => {
    renderHook(() => useRememberLastCopy("u1", "jobs:installer", false, jobsKey, q({})));
    renderHook(() => useRememberLastCopy(undefined, "jobs:installer", true, jobsKey, q({})));
    expect(localStorage.length).toBe(0);
  });
  test("the copy itself is not written again", () => {
    keep("jobs:installer", jobsKey, old);
    const at = stored()!.at;
    renderHook(() => useRememberLastCopy("u1", "jobs:installer", true, jobsKey, q({ data: old, dataUpdatedAt: at })));
    expect(stored()?.data.d).toEqual(old);
  });
});

describe("the pages are wired", () => {
  const src = (f: string) => readFileSync(`src/components/portal/${f}`, "utf8");
  test.each(["JobsLaneScreen.tsx", "EnquiriesScreen.tsx", "InstallerWaitingScreen.tsx"])("%s remembers and shows 'Updating…'", (f) => {
    const s = src(f);
    expect(s).toContain("useRememberLastCopy(");
    expect(s).toContain("isLastCopy(");
    expect(s).toContain("data-last-copy-updating");
  });
  test("every sign-out path clears through clearTradeCache (which clears both prefixes)", () => {
    for (const f of ["src/components/portal/office.tsx", "src/components/portal/AppShell.tsx", "src/lib/auth-change.ts", "src/lib/route-guards.ts", "src/components/trade/TradeShell.tsx"]) expect(readFileSync(f, "utf8")).toContain("clearTradeCache()");
  });
});
