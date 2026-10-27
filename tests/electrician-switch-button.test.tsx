// Jo 28 Oct 2026 (spec rule 3): on the business owner's price card — their own price, then the not-signed-up note,
// then "Use Home Insulation Victoria's electrician ($349) instead". It asks "Are you sure?" first: confirming calls the
// switch once, cancelling calls nothing. No button unless the job is stuck on a not-signed-up electrician.
// Real card in happy-dom; only the server functions are stubbed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const JOB_ID = "00000000-0000-4000-8000-000000003129";
const BUTTON = "Use Home Insulation Victoria's electrician ($349) instead";
const NOTE = "We can't send the owner's quote yet. TEST Sparky hasn't finished signing up with us. Ask them to finish, or use our electrician ($349) instead.";
const switchCalls: unknown[] = [];
let switchResult: { ok: true } | { ok: false; reason: string } = { ok: true };

mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@tanstack/react-router", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
mock.module("@/hooks/use-me", () => ({ useAction: (fn: (o: { data: unknown }) => Promise<unknown>) => async (data: unknown) => fn({ data }) }));
mock.module("@/lib/installer-price.functions", () => ({
  getInstallerPriceFn: async () => ({
    canSet: true, electrician: "My usual electrician (TEST Sparky)", access: { rating: null, issues: [] }, removalRequired: null,
    current: { setAt: "2026-10-27T10:00:00Z", record: { price_inc_gst: 2500, included: ["Ceiling insulation - supply & install"], included_other: null } },
    readyCheck: { address: "1 Test Street", install: "120 m²", removal: "None", access: "Easy", product: "Bradford Gold R5" },
  }),
  setInstallerPriceFn: async () => ({ ok: true }),
}));
mock.module("@/lib/electrician-choice.functions", () => ({
  switchToHivicElectrician: async (o: { data: unknown }) => { switchCalls.push(o.data); return switchResult; },
}));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
const { InstallerPriceCard } = await import("../src/components/trade/InstallerPriceCard");

afterEach(() => { cleanup(); switchCalls.length = 0; switchResult = { ok: true }; });
const show = (notOnboarded: { name: string } | null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><InstallerPriceCard jobId={JOB_ID} electricianNotOnboarded={notOnboarded} /></QueryClientProvider>);
};

describe("switch to our electrician", () => {
  test("no button when the electrician isn't stuck on signing up", async () => {
    const r = show(null);
    await waitFor(() => expect(r.container.textContent).toContain("$2,500 inc GST"));
    expect(r.container.textContent).not.toContain(BUTTON);
    expect(r.container.textContent).not.toContain(NOTE);
  });
  test("price, then the note, then the button", async () => {
    const r = show({ name: "TEST Sparky" });
    await waitFor(() => expect(r.container.textContent).toContain(BUTTON));
    const t = r.container.textContent!;
    expect(t.indexOf("$2,500 inc GST")).toBeGreaterThan(-1);
    expect(t.indexOf("$2,500 inc GST")).toBeLessThan(t.indexOf(NOTE));
    expect(t.indexOf(NOTE)).toBeLessThan(t.indexOf(BUTTON));
  });
  test("asks \"Are you sure?\"; confirming calls the switch once", async () => {
    const r = show({ name: "TEST Sparky" });
    await waitFor(() => expect(r.container.textContent).toContain(BUTTON));
    fireEvent.click(r.getByText(BUTTON));
    expect(r.container.textContent).toContain("Are you sure?");
    expect(switchCalls).toEqual([]);
    fireEvent.click(r.getByText("Yes"));
    await waitFor(() => expect(switchCalls).toEqual([{ jobId: JOB_ID }]));
  });
  test("cancelling calls nothing", async () => {
    const r = show({ name: "TEST Sparky" });
    await waitFor(() => expect(r.container.textContent).toContain(BUTTON));
    fireEvent.click(r.getByText(BUTTON));
    fireEvent.click(r.getByText("Not yet"));
    expect(r.container.textContent).not.toContain("Are you sure?");
    expect(r.container.textContent).toContain(BUTTON);
    await new Promise((res) => setTimeout(res, 20));
    expect(switchCalls).toEqual([]);
  });
  test("a refusal shows its plain reason", async () => {
    switchResult = { ok: false, reason: "This job already uses Home Insulation Victoria's electrician." };
    const r = show({ name: "TEST Sparky" });
    await waitFor(() => expect(r.container.textContent).toContain(BUTTON));
    fireEvent.click(r.getByText(BUTTON));
    fireEvent.click(r.getByText("Yes"));
    await waitFor(() => expect(r.container.textContent).toContain("This job already uses Home Insulation Victoria's electrician."));
    expect(switchCalls).toHaveLength(1);
  });
});
