// Speed (portal speed step 1, task 8): office lists start their server call at route match. Source pins on the four
// routes and the three pages, plus the behaviour of the early start with a real Query client and stubbed server calls.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";

const calls: { name: string; args: any }[] = [];
let fail = false;
mock.module("@/lib/office-screens.functions", () => ({
  getActiveJobsList: async (a: unknown) => { calls.push({ name: "jobs", args: a }); if (fail) throw new Error("no"); return { rows: [] }; },
  getEnquiriesList: async (a: unknown) => { calls.push({ name: "enquiries", args: a }); if (fail) throw new Error("no"); return { rows: [] }; },
}));
mock.module("@/lib/installer-waiting.functions", () => ({
  getInstallerWaitingList: async (a: unknown) => { calls.push({ name: "waiting", args: a }); if (fail) throw new Error("no"); return { rows: [] }; },
}));
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
(globalThis as { window?: unknown }).window = globalThis;

const { startJobsList, startEnquiriesList, startInstallerWaitingList } = await import("../src/lib/office-route-prefetch");
const { jobsListKey, enquiriesListKey, installerWaitingKey } = await import("../src/lib/office-list-keys.core");
const { DEFAULT_VIEW } = await import("../src/lib/jobs-columns.core");

const route = (f: string) => readFileSync(`src/routes/_authenticated/${f}`, "utf8");
const tick = () => new Promise((r) => setTimeout(r, 10));
let qc: QueryClient;
beforeEach(() => { calls.length = 0; fail = false; mem.clear(); qc = new QueryClient(); });

describe("routes declare a loader that starts the list", () => {
  test.each([
    ["admin.jobs.installers.tsx", "startJobsList(context, \"installer\""],
    ["admin.jobs.ours.tsx", "startJobsList(context, \"ours\""],
    ["admin.enquiries.tsx", "startEnquiriesList(context"],
    ["admin.jobs.choose-installer.tsx", "startInstallerWaitingList(context"],
  ])("%s", (file, call) => {
    const s = route(file);
    expect(s).toMatch(/\bloader:/);
    expect(s).toContain(call);
    expect(s).not.toMatch(/from "@\/lib\/[a-z-]+\.functions"/); // server calls stay out of the first download
  });
  test("pages use the shared keys", () => {
    const p = (f: string) => readFileSync(`src/components/portal/${f}`, "utf8");
    expect(p("JobsLaneScreen.tsx")).toContain("jobsListKey(lane, view, search, page)");
    expect(p("EnquiriesScreen.tsx")).toContain("enquiriesListKey(view, search, filters, sort, page)");
    expect(p("InstallerWaitingScreen.tsx")).toContain("installerWaitingKey(includeTest)");
  });
});

describe("early start", () => {
  test("jobs: default view, under the page's key", async () => {
    startJobsList({ queryClient: qc }, "installer", undefined, false);
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.data).toMatchObject({ lane: "installer", search: "", page: 1, includeTest: false, refresh: false });
    expect(qc.getQueryData(jobsListKey("installer", DEFAULT_VIEW, "", 1))).toEqual({ rows: [] });
  });
  test("jobs: uses the saved view and a one-visit stage, like the page", async () => {
    mem.set("hiv:jobs:ours", JSON.stringify({ filters: {}, sort: "owner", dir: "asc", needsUs: true }));
    startJobsList({ queryClient: qc }, "ours", "quote" as never, false);
    await tick();
    expect(calls[0]!.args.data).toMatchObject({ sort: "owner", dir: "asc", needsUs: true, filters: { stage: ["quote"] } });
  });
  test("enquiries and choose installer", async () => {
    startEnquiriesList({ queryClient: qc }, false);
    startInstallerWaitingList({ queryClient: qc }, false);
    await tick();
    expect(calls.map((c) => c.name).sort()).toEqual(["enquiries", "waiting"]);
    expect(qc.getQueryData(enquiriesListKey("offered", "", {}, { k: "", d: "asc" }, 1))).toEqual({ rows: [] });
    expect(qc.getQueryData(installerWaitingKey(false))).toEqual({ rows: [] });
  });
  test("a second start inside 30 s does not call again", async () => {
    startEnquiriesList({ queryClient: qc }, false);
    await tick();
    startEnquiriesList({ queryClient: qc }, false);
    await tick();
    expect(calls).toHaveLength(1);
  });
  test("a hover preload starts nothing", async () => {
    startJobsList({ queryClient: qc }, "ours", undefined, true);
    startEnquiriesList({ queryClient: qc }, true);
    startInstallerWaitingList({ queryClient: qc }, true);
    await tick();
    expect(calls).toHaveLength(0);
  });
  test("a failing call never throws; the page can still ask", async () => {
    fail = true;
    expect(() => startEnquiriesList({ queryClient: qc }, false)).not.toThrow();
    startInstallerWaitingList(undefined, false);
    await tick();
    fail = false;
    const again = await qc.fetchQuery({ queryKey: [...installerWaitingKey(false)], queryFn: async () => "own fetch" });
    expect(again).toBe("own fetch");
  });
});
