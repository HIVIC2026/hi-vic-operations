// Brief E: a failed office action (Installer Offer dispatch, Mitti create/sync) must leave a PERSISTENT
// inline error, not only a transient toast — the UAT observed "no visible response" because the only
// feedback was an auto-dismissing toast. Mounted-component harness (happy-dom) with the server
// functions stubbed: no database, no network, no Supabase.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

// ---------- controllable stubs, installed before the components are imported ----------
const serverImpls = new Map<string, (data: unknown) => Promise<unknown>>();
const toasts: { kind: "success" | "error"; msg: string }[] = [];
let invalidations = 0;
const queryResults: Record<string, { data: unknown; isLoading?: boolean; error?: unknown }> = {};

const stub = (id: string) => {
  const f = (() => undefined) as unknown as { __id: string };
  f.__id = id;
  return f;
};

// The service-role client throws at import without SUPABASE_SERVICE_ROLE_KEY; the functions modules
// load it transitively. An inert stub keeps module loading side-effect free.
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  },
}));

mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: { __id: string }) => async (opts: { data: unknown }) => {
    const impl = serverImpls.get(fn.__id);
    if (!impl) throw new Error(`No stub registered for ${fn.__id}`);
    return impl(opts.data);
  },
  // Module-load stubs for the real server-function chain (components pull in *several* .functions
  // modules transitively via panels.tsx → admin-records.functions → auth-middleware).
  createServerFn: () => {
    const chain: Record<string, unknown> = {
      middleware: () => chain,
      inputValidator: () => chain,
      handler: () => chain,
    };
    return chain;
  },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
  getRequest: () => undefined,
}));

mock.module("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => queryResults[String(opts.queryKey?.[0] ?? "")] ?? { data: undefined, isLoading: true, error: null },
  useQueryClient: () => ({ invalidateQueries: async () => { invalidations++; } }),
}));

mock.module("sonner", () => ({
  toast: {
    success: (msg: string) => toasts.push({ kind: "success", msg }),
    error: (msg: string) => toasts.push({ kind: "error", msg }),
  },
}));

// Load the real functions modules (inert createServerFn chains), then re-export them with the
// functions the two components call replaced by controllable stubs — no database, no network.
const realPortal = await import("../src/lib/portal.functions");
const realOfferDispatch = await import("../src/lib/offer-dispatch.functions");
mock.module("@/lib/portal.functions", () => ({
  ...realPortal,
  createMittiAssessment: stub("createMittiAssessment"),
  syncFromMitti: stub("syncFromMitti"),
  syncPendingMittiAssessments: stub("syncPendingMittiAssessments"),
  priceRectItem: stub("priceRectItem"),
}));
mock.module("@/lib/offer-dispatch.functions", () => ({
  ...realOfferDispatch,
  listChooseTrades: stub("listChooseTrades"),
  sendChosenOffers: stub("sendChosenOffers"),
  setJobOfficePicks: stub("setJobOfficePicks"),
}));

const { render, act, cleanup, fireEvent } = await import("@testing-library/react");
const React = await import("react");
const { ChooseTradePanel } = await import("../src/components/portal/choose-trade");
const { MittiCard } = await import("../src/components/portal/mitti");

afterEach(() => {
  cleanup();
  serverImpls.clear();
  toasts.length = 0;
  invalidations = 0;
});

const TRADE = {
  id: "biz-alpha", business: "TEST Alpha Insulation", contact: null, distanceKm: null, areaNote: "Covers 3000",
  rate: null, rateUnit: "per m²", weekJobs: 0, openOffers: 0, capacity: null, acceptRate: null, avgAcceptHours: null,
  warnings: [], blocker: null, matching: true, alreadyOffered: null,
};

function chooseTradeData() {
  return {
    jobNumber: "HV-1417", suburb: "3000", ownerPrice: null, isTestJob: true, officePicks: true, jobOverride: false,
    matching: [TRADE], others: [],
  };
}

describe("Brief E — Installer Offer dispatch (ChooseTradePanel)", () => {
  test("guard rejection shows the failure inline and it PERSISTS (not only a transient toast)", async () => {
    queryResults["choose-trades"] = { data: chooseTradeData() };
    serverImpls.set("sendChosenOffers", async () => { throw new Error("Ready Check offers cannot start: An installer is already assigned."); });
    const r = render(React.createElement(ChooseTradePanel, { jobId: "job-1" }));
    await act(async () => {});

    await act(async () => { fireEvent.click(r.getByText("Select all")); });
    await act(async () => { fireEvent.click(r.getByRole("button", { name: "Send offer to 1 trade" })); });

    const alert = r.getByRole("alert");
    expect(alert.textContent).toContain("An installer is already assigned.");
    expect(toasts.some((t) => t.kind === "error" && t.msg.includes("An installer is already assigned."))).toBe(true);

    // Persistence: a later re-render (kind switch / query refetch) must NOT lose the failure message.
    await act(async () => { fireEvent.click(r.getByText("Safety check (electricians)")); });
    await act(async () => { fireEvent.click(r.getByText("Ready Check (installers)")); });
    expect(r.getByRole("alert").textContent).toContain("An installer is already assigned.");
  });

  test("successful offer: no error, success toast, queries refreshed", async () => {
    queryResults["choose-trades"] = { data: chooseTradeData() };
    serverImpls.set("sendChosenOffers", async () => ({ offered: 1 }));
    const r = render(React.createElement(ChooseTradePanel, { jobId: "job-1" }));
    await act(async () => {});
    await act(async () => { fireEvent.click(r.getByText("Select all")); });
    await act(async () => { fireEvent.click(r.getByRole("button", { name: "Send offer to 1 trade" })); });
    expect(r.queryByRole("alert")).toBeNull();
    expect(toasts.some((t) => t.kind === "success" && t.msg === "Offer sent to 1 trade")).toBe(true);
    expect(invalidations).toBe(1);
  });
});

describe("Brief E — Mitti create/sync (MittiCard)", () => {
  test("guard rejection on Create & assign shows the failure inline and it PERSISTS", async () => {
    queryResults["mitti"] = { data: { a: null, ev: [] } };
    serverImpls.set("createMittiAssessment", async () => { throw new Error("The PIESA form can only be created once a PIESA visit is confirmed in the portal."); });
    const r = render(React.createElement(MittiCard, { jobId: "job-1", isAdmin: true }));
    await act(async () => {});

    await act(async () => { fireEvent.click(r.getByRole("button", { name: /Create & assign Mitti assessment/ })); });

    expect(r.getByRole("alert").textContent).toContain("The PIESA form can only be created once a PIESA visit is confirmed in the portal.");
    expect(toasts.some((t) => t.kind === "error" && t.msg.includes("PIESA visit is confirmed"))).toBe(true);

    // Persistence: the inline failure stays until the next attempt clears it.
    await act(async () => {});
    expect(r.getByRole("alert").textContent).toContain("PIESA visit is confirmed");
  });

  test("Sync pending failure is surfaced inline, not silently swallowed", async () => {
    queryResults["mitti"] = { data: { a: null, ev: [] } };
    serverImpls.set("syncPendingMittiAssessments", async () => { throw new Error("Mitti rejected the API token."); });
    const r = render(React.createElement(MittiCard, { jobId: "job-1", isAdmin: true }));
    await act(async () => {});

    await act(async () => { fireEvent.click(r.getByRole("button", { name: /Sync pending Mitti assessments/ })); });

    expect(r.getByRole("alert").textContent).toContain("Mitti rejected the API token.");
    expect(toasts.some((t) => t.kind === "error" && t.msg.includes("Mitti rejected the API token."))).toBe(true);
  });

  test("successful create: success toast, no inline error", async () => {
    queryResults["mitti"] = { data: { a: null, ev: [] } };
    serverImpls.set("createMittiAssessment", async () => ({ auditId: "aud-1", reused: false, scope: "PIESA" }));
    const r = render(React.createElement(MittiCard, { jobId: "job-1", isAdmin: true }));
    await act(async () => {});

    await act(async () => { fireEvent.click(r.getByRole("button", { name: /Create & assign Mitti assessment/ })); });

    expect(r.queryByRole("alert")).toBeNull();
    expect(toasts.some((t) => t.kind === "success" && t.msg === "Mitti assessment created & assigned")).toBe(true);
  });
});
