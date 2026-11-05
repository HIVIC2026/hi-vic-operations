// Speed (decision 280): the REAL installer job route (/field/$jobId) with the REAL React Query, mounted in happy-dom.
// On first paint it must make exactly ONE server call — getTradeJobBundle — and every card must find its answer in the
// cache instead of fetching for itself. Only the transport is stubbed (server functions, router, Supabase client, the
// shell): the route's and the cards' own hooks and rendering run. A section the server could not answer is the one
// exception: that card (and only that card) fetches itself, and the page still draws.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const JOB_ID = "00000000-0000-4000-8000-000000000b01";
const calls: Record<string, number> = {};
const unexpected: string[] = [];
let bundle: Record<string, unknown> = {};
const fake = (name: string, impl: () => unknown) => Object.assign(async () => { calls[name] = (calls[name] ?? 0) + 1; return impl(); }, { __name: name });
const refused = (name: string) => fake(name, () => { unexpected.push(name); throw new Error(`unexpected server call ${name}`); });

// --- transport stubs (installed before the route is imported) ---
mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: { __name?: string }) => (typeof fn === "function" ? fn : () => { unexpected.push("unnamed server function"); throw new Error("unexpected unnamed server call"); }),
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
  getRequest: () => undefined,
}));
// The auth middleware (loaded through the functions modules) imports the real server entry, which needs the real router.
mock.module("@tanstack/react-start/server", () => ({ getRequest: () => undefined, getCookie: () => undefined, setCookie: () => undefined, setResponseStatus: () => undefined }));
mock.module("@tanstack/react-router", () => ({
  RouterProvider: () => null, Outlet: () => null,
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, options: opts, useParams: () => ({ jobId: JOB_ID }), useRouteContext: () => ({ user: { id: "user-1" } }), useSearch: () => ({}) }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
  useNavigate: () => () => undefined,
  useRouterState: () => "/field",
  redirect: (o: unknown) => o,
}));
mock.module("@/components/trade/TradeShell", () => ({
  TradeShell: ({ children }: { children: ReactNode }) => <main data-shell="">{children}</main>, TradePublicShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  card: "", navyCard: "", greenBtn: "", ghostBtn: "", inputCls: "", aud: (n: number | null | undefined) => (n == null ? "—" : `$${Math.floor(n)}`),
}));
mock.module("sonner", () => ({ toast: { success: () => undefined, error: () => undefined, warning: () => undefined } }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } }));
const chain = (): Record<string, unknown> => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "not", "contains"]) c[m] = () => c; c.maybeSingle = async () => ({ data: null, count: 0 }); c.single = async () => ({ data: null }); c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0 }).then(r); return c; };
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string) => { unexpected.push(`supabase.rpc ${fn}`); return { data: null, error: null }; },
    from: (t: string) => { unexpected.push(`supabase.from ${t}`); return chain(); },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => { unexpected.push("auth.getUser"); return { data: { user: null }, error: null }; }, getSession: async () => ({ data: { session: null } }) },
  },
}));
mock.module("@/hooks/use-me", () => ({ useAction: () => async () => undefined, useAccess: () => ({ data: null }), useMe: () => ({ data: null }) }));
// The route's own server-function modules: the bundle answers; every per-section function records an unexpected call.
mock.module("@/lib/trade-view.functions", () => ({
  getTradeJobBundle: fake("getTradeJobBundle", () => bundle),
  getTradeJobPage: refused("getTradeJobPage"), getMyMittiInvited: refused("getMyMittiInvited"), getTradeReadyCheckTimes: refused("getTradeReadyCheckTimes"), getTradeSwms: fake("getTradeSwms", () => ({ show: false })),
  setA1ReadyCheckTimeFn: refused("setA1ReadyCheckTimeFn"), offerTradeReadyCheckNewTimes: refused("offerTradeReadyCheckNewTimes"), takeTradeReadyCheckDay: refused("takeTradeReadyCheckDay"), changeTradeReadyCheckTime: refused("changeTradeReadyCheckTime"),
  saveTradeSwmsNote: refused("saveTradeSwmsNote"), signTradeSwms: refused("signTradeSwms"), leadPhoneSwmsLink: refused("leadPhoneSwmsLink"), changeInHouseLeadInstaller: refused("changeInHouseLeadInstaller"), inHouseBookVisit: refused("inHouseBookVisit"), getInHouseBookingTeam: refused("getInHouseBookingTeam"), tradeOwnerCancelled: refused("tradeOwnerCancelled"), tradeHandBack: refused("tradeHandBack"), getInHouseBookingAccess: refused("getInHouseBookingAccess"), getTradeJobStatus: refused("getTradeJobStatus"), askTradeReminder: refused("askTradeReminder"), getMittiJobPresentation: refused("getMittiJobPresentation"),
  getPhotoQuoteMedia: refused("getPhotoQuoteMedia"), tradeSubmitPhotoQuote: refused("tradeSubmitPhotoQuote"),
  getTradeHome: refused("getTradeHome"), getTradeDayView: refused("getTradeDayView"), getTradeDayExtras: refused("getTradeDayExtras"), getTradeMoneyJob: refused("getTradeMoneyJob"), confirmHivicReadyCheckPricingFn: refused("confirmHivicReadyCheckPricingFn"),
  // Electrician-only cards (decisions 315/317/327): never rendered on the installer page under test.
  getTradeFixesTimes: refused("getTradeFixesTimes"), saveTradeFixesTimes: refused("saveTradeFixesTimes"), getTradeSafetyCheckDoc: refused("getTradeSafetyCheckDoc"), getTradeSafetyCheckPdf: refused("getTradeSafetyCheckPdf"),
  getTradeInstallAttendance: refused("getTradeInstallAttendance"), answerTradeInstallAttendance: refused("answerTradeInstallAttendance"),
  // Decision 328: "Check my form now" — only called by a tap, never on first paint.
  checkTradeInstallForm: refused("checkTradeInstallForm"),
}));
mock.module("@/lib/visit-allocation.functions", () => ({ getVisitAllocation: fake("getVisitAllocation", () => ({ canAllocate: false, visits: [] })), allocateVisitFn: refused("allocateVisitFn"), getTeamElectricians: refused("getTeamElectricians"), allocateElectricianFn: refused("allocateElectricianFn") }));
mock.module("@/lib/installer-price.functions", () => ({ getInstallerPriceFn: refused("getInstallerPriceFn"), setInstallerPriceFn: refused("setInstallerPriceFn"), switchToHivElectricianFn: refused("switchToHivElectricianFn") }));
mock.module("@/lib/installer-quote-status.functions", () => ({ getMyOwnerQuote: refused("getMyOwnerQuote") }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { render, cleanup, waitFor } = await import("@testing-library/react");
const { Route } = await import("../src/routes/_authenticated/field.$jobId");
const FieldJob = (Route as unknown as { component: () => ReactNode }).component;

const overview = { id: JOB_ID, job_number: "HV-9001", stage: "installation_scheduling", channel: "hivic_sourced", property_address: "12 Sample Street, Glen Waverley VIC 3150", owner_name: "Helen Example", owner_phone: "0400000000", life_support: false, install_deadline: null, days_remaining: null };
// Part 5's job page shape (join 4 Nov 2026): the Next step box, progress, folded rows and labels the page draws from —
// taken from a real tradeJobPage answer (tests/__snapshots__/trade-job-speed.test.ts.snap) and given this fixture's names.
const page = {
  boss: true, role: "boss", kind: "installer", prices: true, channel: "hivic_sourced", label: "Home Insulation Victoria lead", jobNumber: "HV-9001", stage: "installation_scheduling",
  ownerFirst: "Helen", ownerPiesaConfirmed: false, countdown: null, installBy: null, electricianAttendance: null, mittiInvited: true, notes: [],
  readyCheck: { bookedAt: "2026-10-20T22:00:00Z", done: true },
  install: { bookedAt: null, crew: [], evidenceChecked: false, form: { auditId: null, complete: false }, formCompletedAt: null, ownerReady: { consent: "signed", deposit: "paid" }, rebateSigned: false, recordedAt: null },
  form: { auditId: "a1", completed: true, completedAt: "2026-10-21T00:00:00Z", electrician: null, hasAnswers: true, linked: true, missing: [], needsFinishing: null, needsFinishingItems: [], stops: [] },
  price: { entered: null },
  quote: { accepted: true, acceptedAt: "2026-10-22T01:00:00Z", declined: false, declinedAt: null, formCompleted: true, held: false, line: "Quote accepted", sent: true, sentAt: "2026-10-21T01:00:00Z" },
  pay: { amount: 2400, areaM2: 120, removalM2: null },
  piesa: { bookedAt: null, electrician: "Pat Sparks", fixesNote: null, fixesOpen: false, passedOn: "2026-10-23T00:00:00Z" },
  clearance: { cleared: true, clearedOn: "2026-10-23" },
  complete: { apSignedAt: null, installerSignedAt: null, ownerSignedAt: null, pay: null, piisaSignedAt: null, product: null },
  nextStep: { alsoBookInstall: null, bookBy: "2026-11-22", button: "Book the install", kind: "book_install", lines: [], overdue: false, phone: null, sub: "Deposit paid", title: "Book the install", yours: true },
  progress: [{ label: "Ready Check", state: "done" }, { label: "PIESA", state: "done" }, { label: "Deposit", state: "done" }, { label: "Install", state: "now" }],
  rows: {
    jobDetails: [["Area", "120 m²"], ["Product", "Ceiling batts"]], owner: [["Name", "Helen Example"]], ownerTold: [], siteNotes: [],
    paperwork: [{ label: "Ready Check report (Mitti, with photos)", note: null, ready: true }, { label: "Signed PIESA", note: null, ready: true }],
    visits: [["Ready Check", "Wed 21 Oct, 9:00am"], ["PIESA", "Fri 23 Oct, 11:00am"]],
  },
};
const fullBundle = () => ({
  overview, role: "installer", page,
  installDays: { turn: "installer_to_offer", deadline: "2026-11-22", daysLeft: 28, booked: false, bookedAt: null, expired: false, open: [], days: ["2026-10-27", "2026-10-28"] },
  readyCheckTimes: { applies: true, turn: "booked", canChange: false, days: [], open: [], bookedAt: "2026-10-20T22:00:00Z" },
  allocation: { canAllocate: true, visits: [{ kind: "install", label: "Install", current: null, hasForm: false, options: [] }] },
  swms: { show: false }, workerLinks: { workers: [], links: [], assignedBusinesses: 1, mittiFlag: null }, price: null, ownerQuote: { applies: false },
  crew: { staff: [], selection: null },
  // Part 8 (join): the Next step box reads the in-house booking access on first paint; the bundle seeds it too.
  inHouseBookingAccess: { allowed: false, blockers: ["forbidden"] },
});

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}><FieldJob /></QueryClientProvider>);
  return { ...r, qc };
};
const settle = () => new Promise((r) => setTimeout(r, 80));
afterEach(() => { cleanup(); for (const k of Object.keys(calls)) delete calls[k]; unexpected.length = 0; });

describe("/field/$jobId installer job page — one server call on load", () => {
  test("shows Loading… until the bundle answers, then the page from the cache: 1 call, 0 per-section fetches, 0 client Supabase reads", async () => {
    bundle = fullBundle();
    const { container, qc } = mount();
    expect(container.textContent).toContain("Loading…");
    await waitFor(() => expect(container.textContent).toContain("12 Sample Street, Glen Waverley"));
    await settle();
    expect(container.textContent).toContain("Helen Example");
    // Part 5's page: the Next step box (booking lives there now), the progress strip and the folded rows drew from the seeded page.
    expect(container.textContent).toContain("NEXT STEP");
    expect(container.textContent).toContain("Book the install");
    expect(container.textContent).toContain("Deposit paid");
    expect(container.textContent).toContain("Paperwork");
    expect(container.textContent).not.toContain("Who's on the crew today?"); // the old crew picker and allocation card are gone (Part 5)
    expect(calls).toEqual({ getTradeJobBundle: 1 });
    expect(unexpected).toEqual([]);
    // The cards' own cache entries hold the bundle's answers, under their own keys, so their actions' invalidations keep working.
    expect(qc.getQueryData(["job", JOB_ID])).toEqual(overview);
    expect(qc.getQueryData(["myrole", JOB_ID])).toBe("installer");
    expect(qc.getQueryData(["trade-job-page", JOB_ID])).toEqual(page);
    expect(qc.getQueryData(["visit-allocation", JOB_ID])).toEqual(bundle.allocation);
    expect(qc.getQueryData(["installer-price", JOB_ID])).toBeNull();
    expect(qc.getQueryData(["in-house-booking-access", JOB_ID])).toEqual({ allowed: false, blockers: ["forbidden"] });
  });
  test("a section the server could not answer: that card fetches itself, the rest of the page still draws", async () => {
    bundle = { ...fullBundle(), swms: { error: "SWMS read failed" }, allocation: { error: "staff list unavailable" } };
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("12 Sample Street, Glen Waverley"));
    await waitFor(() => expect(calls.getTradeSwms).toBe(1));
    await settle();
    // Part 5's page has no allocation card any more (the Next step box books), so only the safety plan fetches for itself.
    expect(calls).toEqual({ getTradeJobBundle: 1, getTradeSwms: 1 });
    expect(unexpected).toEqual([]);
    expect(container.textContent).toContain("Helen Example");
  });
  test("the whole bundle refused: the page renders and the existing per-card loading takes over (no blank page)", async () => {
    bundle = { overview: { error: "This job isn't assigned to you." }, role: { error: "x" }, workerLinks: { error: "x" }, price: { error: "x" } };
    const { container } = mount();
    await waitFor(() => expect(unexpected.length).toBeGreaterThan(0)); // useJob now fetches getJobOverview itself (stubbed here as unexpected: it is the pre-bundle path)
    expect(calls.getTradeJobBundle).toBe(1);
    expect(container.querySelector("main[data-shell]")).not.toBeNull();
  });
});
