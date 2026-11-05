// Portal speed step 2, Task 5: the office and installer job pages draw at once from the last copy on this device, say
// "Updating…" and keep their buttons waiting (Send, Give, Pay, Book, Cancel) until the fresh answer arrives. Copies are per
// signed-in user, ignored after 24 h and cleared on sign-out (trade-cache.ts — the same store as Step 1, no third cache).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";

const { clearLastCopies, clearTradeCache, resetTradeCacheSignOut, writeLastCopy } = await import("../src/lib/trade-cache");
const { startOfficeJob, officeJobKey, officeJobCopyName } = await import("../src/lib/office-route-prefetch");
const { isLastCopy, useRememberLastCopy } = await import("../src/lib/office-last-copy");
const { LastCopyWait } = await import("../src/lib/last-copy-wait");

const J = "00000000-0000-4000-8000-000000000001";
const key = officeJobKey(J);
const old = { header: { jobId: J, jobNumber: "HV-1001" }, which: "old" };
const fresh = { header: { jobId: J, jobNumber: "HV-1001" }, which: "fresh" };
const keep = (uid = "u1", data: unknown = old) => writeLastCopy(uid, officeJobCopyName(J), { k: JSON.stringify(key), d: data });
let qc: QueryClient;
beforeEach(() => { localStorage.clear(); resetTradeCacheSignOut(); qc = new QueryClient(); });
afterEach(() => { cleanup(); setSystemTime(); });

/** The office job page's query, as the route makes it (always asked again while the copy shows). */
function useJobPage(load: () => Promise<unknown>, uid: string) {
  const q = useQuery({ queryKey: key, queryFn: load, staleTime: 15_000, refetchOnMount: (query) => (isLastCopy(key, query.state.dataUpdatedAt) ? "always" : true) });
  useRememberLastCopy(uid, officeJobCopyName(J), true, key, q);
  return { ...q, waiting: isLastCopy(key, q.dataUpdatedAt) && !q.error };
}
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);

describe("office job page last copy", () => {
  test("a second visit within 24 h draws the copy before the fetch answers, shows Updating… and holds the buttons until fresh", async () => {
    keep();
    startOfficeJob({ queryClient: qc, user: { id: "u1" } }, J, false);
    let answer!: (v: unknown) => void;
    const load = () => new Promise((r) => { answer = r; });
    const { result } = renderHook(() => useJobPage(load, "u1"), { wrapper });
    expect((result.current.data as typeof old).which).toBe("old");
    expect(result.current.waiting).toBe(true);
    await waitFor(() => expect(typeof answer).toBe("function")); // the page asked again on mount, even with a copy
    answer(fresh);
    await waitFor(() => expect((result.current.data as typeof fresh).which).toBe("fresh"));
    expect(result.current.waiting).toBe(false);
  });

  test("a different user on the same device gets no copy", () => {
    keep("u1");
    startOfficeJob({ queryClient: qc, user: { id: "u2" } }, J, false);
    expect(qc.getQueryData([...key])).toBeUndefined();
  });

  test("sign-out clears the copy", () => {
    keep();
    clearTradeCache();
    startOfficeJob({ queryClient: qc, user: { id: "u1" } }, J, false);
    expect(qc.getQueryData([...key])).toBeUndefined();
    resetTradeCacheSignOut();
    keep();
    clearLastCopies(); // signing in over an existing session
    startOfficeJob({ queryClient: qc, user: { id: "u1" } }, J, false);
    expect(qc.getQueryData([...key])).toBeUndefined();
  });

  test("a copy older than 24 hours is ignored", () => {
    setSystemTime(new Date("2026-11-05T00:00:00Z"));
    keep();
    setSystemTime(new Date("2026-11-06T00:00:01Z"));
    startOfficeJob({ queryClient: qc, user: { id: "u1" } }, J, false);
    expect(qc.getQueryData([...key])).toBeUndefined();
  });

  test("a hover preload never seeds; another job's copy never seeds this job", () => {
    keep();
    startOfficeJob({ queryClient: qc, user: { id: "u1" } }, J, true);
    expect(qc.getQueryData([...key])).toBeUndefined();
    startOfficeJob({ queryClient: qc, user: { id: "u1" } }, "00000000-0000-4000-8000-000000000002", false);
    expect(qc.getQueryData([...officeJobKey("00000000-0000-4000-8000-000000000002")])).toBeUndefined();
  });
});

describe("LastCopyWait (both job pages)", () => {
  const page = (waiting: boolean) => render(React.createElement(LastCopyWait, { waiting },
    React.createElement("button", { type: "button" }, "Send quote"),
    React.createElement("button", { type: "button" }, "Book the install"),
    React.createElement("button", { type: "button" }, "Cancel job"),
  ));
  // A disabled <fieldset> disables every control inside it (HTML standard); happy-dom does not compute :disabled through
  // it, so the test checks the enclosing fieldset.
  const held = (el: HTMLElement) => (el.closest("fieldset") as HTMLFieldSetElement | null)?.disabled === true;
  test("while waiting: Updating… and Send / Book / Cancel cannot be pressed", () => {
    const r = page(true);
    expect(r.getByText("Updating…")).toBeTruthy();
    for (const name of ["Send quote", "Book the install", "Cancel job"]) expect(held(r.getByText(name))).toBe(true);
  });
  test("fresh: no line, every button works", () => {
    const r = page(false);
    expect(r.queryByText("Updating…")).toBeNull();
    for (const name of ["Send quote", "Book the install", "Cancel job"]) expect(held(r.getByText(name))).toBe(false);
  });
});

describe("wiring", () => {
  test("both job pages wrap their actions in LastCopyWait; the office page seeds in its loader and holds the cancel dialog", () => {
    const office = readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8");
    expect(office).toContain("loader: ({ context, params, preload }) => startOfficeJob(context, params.jobId, preload)");
    expect(office).toContain("<LastCopyWait waiting={waiting}>");
    expect(office).toContain("cancelOpen={cancelOpen && !waiting}");
    const field = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(field).toContain("<LastCopyWait waiting={waiting}>");
    expect(field).toContain("const isCopy = !!seed && q.dataUpdatedAt === seed.at && !q.isError;");
  });
});
