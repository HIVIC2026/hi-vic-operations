// Jo 27 Oct 2026 (HV-3129): when the electrician's price is not known the held draft is withdrawn and no new one is made,
// so the owner-quote read says it does not apply. The installer page then shows ONLY their own price: no "See the
// owner's quote" preview, no empty or broken preview, no error. Real cards in happy-dom; only server functions stubbed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const JOB_ID = "00000000-0000-4000-8000-000000003129";
mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@tanstack/react-router", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
mock.module("@/hooks/use-me", () => ({ useAction: (fn: (o: { data: unknown }) => Promise<unknown>) => async (data: unknown) => fn({ data }) }));
// Jo 28 Oct 2026: the card also carries the switch-to-our-electrician button (not used here).
mock.module("@/lib/electrician-choice.functions", () => ({ switchToHivicElectrician: async () => ({ ok: true }) }));
mock.module("@/lib/installer-price.functions", () => ({
  getInstallerPriceFn: async () => ({
    canSet: true, electrician: "My usual electrician (TEST Sparky)", access: { rating: null, issues: [] }, removalRequired: null,
    current: { setAt: "2026-10-27T10:00:00Z", record: { price_inc_gst: 2500, included: ["Ceiling insulation - supply & install"], included_other: null } },
    readyCheck: { address: "1 Test Street", install: "120 m²", removal: "None", access: "Easy", product: "Bradford Gold R5" },
  }),
  setInstallerPriceFn: async () => ({ ok: true }),
}));
let ownerQuoteReads = 0;
// What myOwnerQuoteFor returns when the job has no draft/issued/accepted/declined quote (loadInstallerQuote → NONE).
mock.module("@/lib/installer-quote-status.functions", () => ({ getMyOwnerQuote: async () => { ownerQuoteReads++; return { applies: false }; } }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { render, cleanup, waitFor } = await import("@testing-library/react");
const { InstallerPriceCard } = await import("../src/components/trade/InstallerPriceCard");
const { OwnerQuoteCard } = await import("../src/components/trade/OwnerQuoteCard");

afterEach(() => { cleanup(); ownerQuoteReads = 0; });

describe("held with no known electrician price: only the installer's own price shows", () => {
  test("price card shows $2,500; no owner-quote preview, nothing empty, no stale $4,201.25", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(<QueryClientProvider client={qc}><InstallerPriceCard jobId={JOB_ID} /><OwnerQuoteCard jobId={JOB_ID} hideStatus /></QueryClientProvider>);
    await waitFor(() => expect(r.container.textContent).toContain("$2,500 inc GST"));
    await waitFor(() => expect(ownerQuoteReads).toBe(1));
    expect(r.container.querySelector("[data-owner-quote]")).toBeNull();
    expect(r.container.textContent).not.toContain("See the owner's quote");
    expect(r.container.textContent).not.toContain("4,201.25");
    expect(r.container.textContent).not.toContain("$0.00");
  });
});
