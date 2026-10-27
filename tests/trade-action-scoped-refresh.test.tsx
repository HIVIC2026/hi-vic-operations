// Speed (trade buttons, Jo approved 28 Oct 2026, fix 1 "Only reload that job"): a button finishes as soon as the server
// replies. Afterwards only that job's readers (and trade home) are refreshed, in the background, so the button never waits
// for the page to reload. Office screens keep refreshing everything (still in the background) and still show fresh data.
// Real React Query + the real hook and cards in happy-dom; only the server functions and the Supabase client are stubbed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const JOB = "00000000-0000-4000-8000-00000000d001";
const OTHER_JOB = "00000000-0000-4000-8000-00000000d002";

mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("sonner", () => ({ toast: { success: () => undefined, error: () => undefined, warning: () => undefined } }));
mock.module("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
mock.module("@/lib/route-guards", () => ({ currentUser: async () => ({ data: { user: null } }), loadAccess: async () => null }));
mock.module("@/lib/my-profile", () => ({ readMyProfile: async () => ({ data: null }) }));

/** A read the test releases by hand, so "the refresh is still running" is a fact, not a race. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { wait: () => p, open };
}

// --- trade card: "I'll be there" (decision 327) ---
let attendanceAnswered = false;
let attendanceGate = gate();
let attendanceReads = 0;
mock.module("@/lib/trade-view.functions", () => ({
  getTradeInstallAttendance: async () => {
    attendanceReads++;
    if (attendanceReads > 1) await attendanceGate.wait();
    return { show: true, bookingId: "b1", line: "Install day: Tue 3 Nov", state: attendanceAnswered ? "confirmed" : "asked", auto: false, days: [], deadline: null, released: null };
  },
  answerTradeInstallAttendance: async () => { attendanceAnswered = true; return { ok: true }; },
}));

// --- office card: Final check › Approve (decision 372) ---
let approved = false;
mock.module("@/lib/ap-queue.functions", () => ({
  getFinalCheck: async () => ({ stage: approved ? "ready_for_veec" : "ap_review", ready: true, flags: [], items: [{ key: "k", label: "Install evidence", state: "pass", why: [], detail: null, evidence: null }] }),
  approveApJob: async () => { approved = true; return { ok: true }; },
}));

// --- trade card: Save price (decision 278) with the owner-quote preview beside it ---
let priceSaved = false;
let priceGate = gate();
let priceReads = 0;
const priceView = () => ({
  canSet: true, electrician: "Home Insulation Victoria electrician", access: { rating: null, issues: [] }, removalRequired: null,
  readyCheck: { address: "1 Test Street", install: "120 m²", removal: "None", access: "Easy", product: "Bradford Gold R5" },
  current: { record: { price_inc_gst: priceSaved ? 3000 : 2000, included: ["Ceiling insulation - supply & install"], included_other: null, electrician: null }, setAt: priceSaved ? "2026-10-28T01:00:00Z" : "2026-10-27T01:00:00Z", setBy: null },
});
mock.module("@/lib/installer-price.functions", () => ({
  getInstallerPriceFn: async () => { priceReads++; if (priceReads > 1) await priceGate.wait(); return priceView(); },
  setInstallerPriceFn: async () => { priceSaved = true; return { ok: true, setAt: "2026-10-28T01:00:00Z" }; },
}));
let quoteGate = gate();
let quoteReads = 0;
mock.module("@/lib/installer-quote-status.functions", () => ({
  getMyOwnerQuote: async () => {
    quoteReads++;
    if (quoteReads > 1) await quoteGate.wait();
    const line = priceSaved ? 3000 : 2000;
    return { applies: true, priceHidden: false, quoteId: "q", lines: [{ description: "Insulation works by your installer", explanation: null, quantity: 1, unit: "flat", total: line }], subtotal: line + 698, rebate: 0, total: line + 698, blockers: [], sent: false, held: true, formCompleted: true, line: "held" };
  },
}));

const { QueryClient, QueryClientProvider, QueryObserver } = await import("@tanstack/react-query");
const { render, renderHook, cleanup, fireEvent, waitFor } = await import("@testing-library/react");
const { useAction } = await import("../src/hooks/use-me");
const { InstallAttendanceCard } = await import("../src/components/trade/InstallAttendanceCard");
const { FinalCheckScreen } = await import("../src/components/portal/final-check");
const { InstallerPriceCard } = await import("../src/components/trade/InstallerPriceCard");
const { OwnerQuoteCard } = await import("../src/components/trade/OwnerQuoteCard");

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (qc: InstanceType<typeof QueryClient>) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const watch = (qc: InstanceType<typeof QueryClient>, key: unknown[], read: () => Promise<string>) => {
  const o = new QueryObserver(qc, { queryKey: key, queryFn: read });
  const stop = o.subscribe(() => {});
  return { o, stop };
};

afterEach(() => { cleanup(); attendanceAnswered = false; attendanceGate = gate(); attendanceReads = 0; approved = false; priceSaved = false; priceGate = gate(); priceReads = 0; quoteGate = gate(); quoteReads = 0; });

describe("useAction: the button finishes when the server replies", () => {
  test("a trade action resolves while the job's cards are still re-reading; they show the fresh answer after", async () => {
    const qc = client();
    let saved = false;
    const g = gate();
    const page = watch(qc, ["trade-job-page", JOB], async () => { if (saved) await g.wait(); return saved ? "fresh" : "old"; });
    await page.o.refetch();
    const { result } = renderHook(() => useAction(async (_: { data: { jobId: string } }) => { saved = true; return { ok: true }; }, { refresh: { jobId: JOB } }), { wrapper: wrap(qc) });
    const out = await result.current({ jobId: JOB });
    expect(out).toEqual({ ok: true });
    // The reply is back but the card's re-read has not finished: the button did not wait for it.
    expect(qc.getQueryState(["trade-job-page", JOB])?.fetchStatus).toBe("fetching");
    expect(qc.getQueryData(["trade-job-page", JOB])).toBe("old");
    g.open();
    await waitFor(() => expect(qc.getQueryData(["trade-job-page", JOB])).toBe("fresh"));
    page.stop(); qc.clear();
  });

  test("a failed action reports the refusal and refreshes nothing", async () => {
    const qc = client();
    qc.setQueryData(["trade-job-page", JOB], "old");
    const { result } = renderHook(() => useAction(async () => { throw new Error("TEST refusal"); }, { refresh: { jobId: JOB } }), { wrapper: wrap(qc) });
    expect(await result.current({})).toBeUndefined();
    expect(qc.getQueryState(["trade-job-page", JOB])?.isInvalidated).toBe(false);
    qc.clear();
  });
});

describe("useAction: a trade action reloads only that job", () => {
  test("the job's readers and trade home are refreshed; another job, the office lists and the sign-in reads are not", async () => {
    const qc = client();
    const keys: unknown[][] = [["trade-job-page", JOB], ["my-owner-quote", JOB], ["installer-price", JOB], ["trade-day", JOB], ["trade-home"],
      ["trade-job-page", OTHER_JOB], ["office-enquiries"], ["me-access"], ["mitti-invited"], ["trade-money-v2"]];
    for (const k of keys) qc.setQueryData(k, "old");
    const { result } = renderHook(() => useAction(async () => ({ ok: true }), { refresh: { jobId: JOB } }), { wrapper: wrap(qc) });
    await result.current({ jobId: JOB });
    const invalidated = keys.filter((k) => qc.getQueryState(k)?.isInvalidated).map((k) => k.join(":"));
    expect(invalidated).toEqual([`trade-job-page:${JOB}`, `my-owner-quote:${JOB}`, `installer-price:${JOB}`, `trade-day:${JOB}`, "trade-home"]);
    qc.clear();
  });

  test("a call site can name what else its action changes (e.g. the Money page after the install is finished)", async () => {
    const qc = client();
    for (const k of [["trade-money-v2"], ["trade-money-extras"], ["office-enquiries"]]) qc.setQueryData(k, "old");
    const { result } = renderHook(() => useAction(async () => ({ ok: true }), { refresh: { jobId: JOB, also: ["trade-money-v2", "trade-money-extras"] } }), { wrapper: wrap(qc) });
    await result.current({ jobId: JOB });
    expect(qc.getQueryState(["trade-money-v2"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["trade-money-extras"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["office-enquiries"])?.isInvalidated).toBe(false);
    qc.clear();
  });

  test("refresh: false still refreshes nothing (document open, manual PIESA field saves)", async () => {
    const qc = client();
    qc.setQueryData(["assessment", JOB], "old");
    const { result } = renderHook(() => useAction(async () => ({ ok: true }), { refresh: false }), { wrapper: wrap(qc) });
    await result.current({ jobId: JOB });
    expect(qc.getQueryState(["assessment", JOB])?.isInvalidated).toBe(false);
    qc.clear();
  });
});

describe("a real trade card: 'I'll be there'", () => {
  test("the button is free again as soon as the answer is saved; the card shows 'confirmed' once its own re-read lands", async () => {
    const qc = client();
    qc.setQueryData(["trade-job-page", OTHER_JOB], "untouched");
    const r = render(<QueryClientProvider client={qc}><InstallAttendanceCard jobId={JOB} /></QueryClientProvider>);
    await waitFor(() => expect(r.getByText("I'll be there")).toBeTruthy());
    fireEvent.click(r.getByText("I'll be there"));
    await waitFor(() => expect(attendanceAnswered).toBe(true));
    // Server replied; the card's re-read is still held open — yet "Can't make it" is enabled again (busy cleared).
    await waitFor(() => expect((r.getByText("Can't make it").closest("button") as HTMLButtonElement).disabled).toBe(false));
    expect(qc.getQueryState(["trade-install-attendance", JOB])?.fetchStatus).toBe("fetching");
    expect(qc.getQueryState(["trade-job-page", OTHER_JOB])?.isInvalidated).toBe(false);
    attendanceGate.open();
    await waitFor(() => expect(r.container.querySelector("[data-attendance-confirmed]")).not.toBeNull());
    qc.clear();
  });
});

describe("a real trade card: Save price", () => {
  test("the button is free once the price is saved; the card shows the new price at once and the owner-quote preview re-reads to the new draft", async () => {
    const qc = client();
    const r = render(<QueryClientProvider client={qc}><InstallerPriceCard jobId={JOB} /><OwnerQuoteCard jobId={JOB} hideStatus /></QueryClientProvider>);
    await waitFor(() => expect(r.container.textContent).toContain("See the owner's quote"));
    fireEvent.click(r.getByText("See the owner's quote"));
    await waitFor(() => expect(r.container.textContent).toContain("$2,000.00"));
    fireEvent.click(r.getByText("Change your price"));
    fireEvent.change(r.getByLabelText("Your price to the owner (inc GST)"), { target: { value: "3000" } });
    fireEvent.submit(r.container.querySelector("form")!);
    // Saved: the form closes and shows the new price while both re-reads are still held open.
    for (let i = 0; i < 20 && r.container.querySelector("form"); i++) await new Promise((x) => setTimeout(x, 10));
    expect(r.container.querySelector("form")).toBeNull();
    expect(priceSaved).toBe(true);
    expect(r.container.querySelector("[data-installer-price]")!.textContent).toContain("3,000");
    expect(qc.getQueryState(["my-owner-quote", JOB])?.fetchStatus).toBe("fetching");
    expect(qc.getQueryState(["installer-price", JOB])?.fetchStatus).toBe("fetching");
    quoteGate.open(); priceGate.open();
    await waitFor(() => expect(r.container.textContent).toContain("$3,000.00"));
    expect(r.container.textContent).not.toContain("$2,000.00");
    qc.clear();
  });
});

describe("an office call site: Final check › Approve", () => {
  test("after Approve the screen shows the fresh answer, and the office lists are refreshed too (behind the button)", async () => {
    const qc = client();
    qc.setQueryData(["office-enquiries"], "old");
    const r = render(<QueryClientProvider client={qc}><FinalCheckScreen jobId={JOB} /></QueryClientProvider>);
    await waitFor(() => expect(r.getByText("Approve")).toBeTruthy());
    fireEvent.click(r.getByText("Approve"));
    await waitFor(() => expect(r.container.textContent).toContain("Approve appears when the job reaches Final check"));
    expect(approved).toBe(true);
    expect(qc.getQueryState(["office-enquiries"])?.isInvalidated).toBe(true);
    qc.clear();
  });
});
