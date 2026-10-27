// Jo 27 Oct 2026 (HV-3197): after "Save price" the owner's quote preview must show the NEW held draft straight away,
// not the superseded one until a reload. The card itself refreshes the preview and the job page once the save (which
// waits for the redraft on the server) has finished. Real React Query + the real cards in happy-dom; only the server
// functions are stubbed. `useAction`'s refresh-everything is stubbed out so the card's own refresh is what is tested.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const JOB_ID = "00000000-0000-4000-8000-000000000c01";
let installerLine = 20;
const calls: string[] = [];

mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@tanstack/react-router", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
mock.module("@/hooks/use-me", () => ({ useAction: (fn: (o: { data: unknown }) => Promise<unknown>) => async (data: unknown) => fn({ data }) }));
const view = () => ({
  canSet: true, current: null, electrician: "Home Insulation Victoria electrician", access: { rating: null, issues: [] }, removalRequired: null,
  readyCheck: { address: "1 Test Street", install: "120 m²", removal: "None", access: "Easy", product: "Bradford Gold R5" },
});
mock.module("@/lib/installer-price.functions", () => ({
  getInstallerPriceFn: async () => { calls.push("getInstallerPrice"); return view(); },
  // The real save resolves only after the redraft; here the new held draft exists once the save resolves.
  setInstallerPriceFn: async () => { calls.push("setInstallerPrice"); installerLine = 3000; return { ok: true, setAt: "2026-10-27T10:00:00Z" }; },
}));
mock.module("@/lib/installer-quote-status.functions", () => ({
  getMyOwnerQuote: async () => {
    calls.push("getMyOwnerQuote");
    return { applies: true, priceHidden: false, quoteId: "q", lines: [{ description: "Insulation works by your installer", explanation: null, quantity: 1, unit: "flat", total: installerLine }], subtotal: installerLine + 698, rebate: 0, total: installerLine + 698, blockers: [], sent: false, held: true, formCompleted: true, line: "held" };
  },
}));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
const { InstallerPriceCard } = await import("../src/components/trade/InstallerPriceCard");
const { OwnerQuoteCard } = await import("../src/components/trade/OwnerQuoteCard");

afterEach(() => { cleanup(); calls.length = 0; installerLine = 20; });

describe("InstallerPriceCard: Save price refreshes the owner-quote preview", () => {
  test("after a successful save the preview re-reads the owner quote and shows the new installer line", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(<QueryClientProvider client={qc}><InstallerPriceCard jobId={JOB_ID} /><OwnerQuoteCard jobId={JOB_ID} hideStatus /></QueryClientProvider>);
    await waitFor(() => expect(r.container.textContent).toContain("See the owner's quote"));
    fireEvent.click(r.getByText("See the owner's quote"));
    await waitFor(() => expect(r.container.textContent).toContain("$20.00"));
    // The job page query is refreshed too (its quote status line reads the same draft).
    qc.setQueryData(["trade-job-page", JOB_ID], { stale: true });
    fireEvent.change(r.getByLabelText("Your price to the owner (inc GST)"), { target: { value: "3000" } });
    fireEvent.submit(r.container.querySelector("form")!);
    await waitFor(() => expect(calls).toContain("setInstallerPrice"));
    await waitFor(() => expect(r.container.textContent).toContain("$3,000.00"));
    expect(r.container.textContent).not.toContain("$20.00");
    expect(calls.filter((c) => c === "getMyOwnerQuote").length).toBe(2);
    expect(qc.getQueryState(["trade-job-page", JOB_ID])?.isInvalidated).toBe(true);
  });
});
