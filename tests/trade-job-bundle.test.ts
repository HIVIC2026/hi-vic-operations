// Speed (decision 280): the installer job page's ONE server call. The bundle must (a) ask each section's existing server
// helper once, with the one checked trade context, (b) keep every section's own role rule (staff never see the price),
// (c) turn a failed section into `{ error }` instead of failing the page, and (d) seed exactly the Query keys the cards
// read. No database: the section readers are injected.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// The service-role client throws at import without a key; the bundle module only type-imports the server helpers but
// shares the process with them in other tests, so keep module loading side-effect free here too.
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } }));

const { tradeJobBundle } = await import("../src/lib/trade-job-bundle.server");
type Deps = Parameters<typeof tradeJobBundle>[3] & object;
const { BUNDLE_QUERY_KEYS, bundleUsable, isSectionError, seedPlan, sectionError } = await import("../src/lib/trade-job-bundle.core");

const USER = "u-1", JOB = "00000000-0000-4000-8000-000000000001", SB = { rpc: async () => ({ data: null, error: null }) } as never;
const access = (o: { boss?: boolean; kind?: "installer" | "electrician"; invited?: boolean } = {}) => ({
  biz: { id: "biz-1", name: "Test Installs", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: true, onboarding_notes: null, mitti_account_invited: o.invited ?? true },
  kind: o.kind ?? "installer", boss: o.boss ?? true, firstName: "Sam", profile: null, isTest: true, checkedFor: { userId: USER, jobId: JOB },
}) as never;

function fakeDeps(over: Partial<Record<keyof Deps, unknown>> = {}, opts: { boss?: boolean; kind?: "installer" | "electrician"; role?: string } = {}) {
  const calls: Record<string, unknown[][]> = {};
  const rec = (name: string, out: unknown) => (...a: unknown[]) => { (calls[name] ??= []).push(a); return Promise.resolve(out); };
  const deps = {
    overview: rec("overview", { role: opts.role ?? "installer", row: { id: JOB, stage: "installation_scheduling", channel: "installer_sourced" } }),
    access: rec("access", access(opts)),
    page: rec("page", { jobNumber: "HV-1", boss: opts.boss ?? true }),
    installDays: rec("installDays", { turn: "installer_to_offer" }),
    readyCheckTimes: rec("readyCheckTimes", { applies: false }),
    allocation: rec("allocation", { canAllocate: true, visits: [] }),
    swms: rec("swms", { show: false }),
    workerLinks: rec("workerLinks", { workers: [], links: [], assignedBusinesses: 1 }),
    price: rec("price", { canSet: true, current: null }),
    ownerQuote: rec("ownerQuote", { applies: false }),
    crew: rec("crew", { staff: [], selection: null }),
    ...over,
  } as unknown as Deps;
  return { deps, calls };
}

describe("tradeJobBundle (server, injected readers)", () => {
  test("business owner: every section asked exactly once, each trade section with the ONE checked context", async () => {
    const { deps, calls } = fakeDeps();
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    for (const k of ["overview", "access", "page", "installDays", "readyCheckTimes", "allocation", "swms", "workerLinks", "price", "ownerQuote", "crew"]) expect(calls[k]?.length, k).toBe(1);
    const pre = (await deps.access(USER, JOB)) as { checkedFor: unknown };
    for (const k of ["page", "readyCheckTimes", "allocation", "swms"]) expect((calls[k]![0]![2] as { checkedFor: unknown }).checkedFor, k).toEqual(pre.checkedFor);
    expect(b.overview).toEqual({ id: JOB, stage: "installation_scheduling", channel: "installer_sourced" });
    expect(b.role).toBe("installer");
    expect(b.price).toEqual({ canSet: true, current: null });
    expect(b.mittiInvited).toEqual({ invited: true });
    expect(Object.values(b).some(isSectionError)).toBe(false);
  });
  test("staff login (not the business owner): price is null and the price reader is never even asked (decision 278)", async () => {
    const { deps, calls } = fakeDeps({}, { boss: false });
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    expect(b.price).toBeNull();
    expect(calls.price).toBeUndefined();
    expect(calls.page?.length).toBe(1); // the rest of the page is theirs as before
  });
  test("electrician's visit: installer sections are not asked; overview, role and staff links still answer", async () => {
    const { deps, calls } = fakeDeps({}, { kind: "electrician", role: "electrician" });
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    expect(b.role).toBe("electrician");
    for (const k of ["page", "installDays", "readyCheckTimes", "allocation", "swms", "price", "ownerQuote", "crew"]) expect(calls[k], k).toBeUndefined();
    expect(b.page).toBeUndefined();
    expect(b.price).toBeNull();
    expect(calls.workerLinks?.length).toBe(1);
    expect(seedPlan(b, JOB).map((s) => s.section)).toEqual(["overview", "role", "workerLinks", "price", "mittiInvited"]);
  });
  test("speed (Task 6): an installer business's sections start before the overview answers; the overview still decides", async () => {
    let release!: (v: unknown) => void;
    const slow = new Promise((r) => { release = r; });
    const { deps, calls } = fakeDeps({ overview: () => slow });
    const pending = tradeJobBundle(SB, USER, JOB, deps);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    for (const k of ["page", "installDays", "readyCheckTimes", "allocation", "swms", "workerLinks", "price", "ownerQuote"]) expect(calls[k]?.length, k).toBe(1);
    expect(calls.crew).toBeUndefined(); // the crew needs the overview's stage (D6)
    release({ role: "installer", row: { id: JOB, stage: "installation_scheduling", channel: "installer_sourced" } });
    const b = await pending;
    expect(calls.crew?.length).toBe(1);
    expect(b.page).toEqual({ jobNumber: "HV-1", boss: true });
  });
  test("speed (Task 6): an installer business whose role on this job is not installer gets exactly the old answer", async () => {
    const { deps } = fakeDeps({}, { kind: "installer", role: "owner" });
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    for (const k of ["page", "installDays", "readyCheckTimes", "allocation", "swms", "ownerQuote", "crew"] as const) expect(b[k], k).toBeUndefined();
    expect(b.price).toBeNull();
    expect(b.workerLinks).toEqual({ workers: [], links: [], assignedBusinesses: 1 });
    expect(b.role).toBe("owner");
  });
  test("one failing section becomes { error } and every other section still answers (the page never goes blank)", async () => {
    const { deps } = fakeDeps({ swms: () => Promise.reject(new Error("SWMS read failed")), installDays: () => Promise.reject(new Error("no quoted installer")) });
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    expect(b.swms).toEqual({ error: "SWMS read failed" });
    expect(b.installDays).toEqual({ error: "no quoted installer" });
    expect(b.page).toEqual({ jobNumber: "HV-1", boss: true });
    expect(b.overview).toMatchObject({ id: JOB });
    expect(bundleUsable(b)).toBe(true);
    const seeded = seedPlan(b, JOB).map((s) => s.section);
    expect(seeded).not.toContain("swms");
    expect(seeded).not.toContain("installDays");
    expect(seeded).toEqual(expect.arrayContaining(["overview", "role", "page", "readyCheckTimes", "allocation", "workerLinks", "price", "ownerQuote", "crew", "mittiInvited"]));
  });
  test("trade access refused: the refusal reaches every trade section (as the eight separate calls were refused one by one); the overview keeps its own answer", async () => {
    const { deps, calls } = fakeDeps({ access: () => Promise.reject(new Error("This job isn't assigned to you.")) });
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    for (const k of ["page", "installDays", "readyCheckTimes", "allocation", "swms", "workerLinks", "price", "ownerQuote", "crew", "mittiInvited"] as const) expect(b[k], k).toEqual({ error: "This job isn't assigned to you." });
    expect(b.overview).toMatchObject({ id: JOB });
    for (const k of ["page", "installDays", "swms", "price"]) expect(calls[k], k).toBeUndefined();
  });
  test("overview refused (e.g. a TEST login on a live job): the page section is its own error, the trade sections still answer", async () => {
    const { deps } = fakeDeps({ overview: () => Promise.reject(new Error("TEST accounts can only use active TEST journeys.")) });
    const b = await tradeJobBundle(SB, USER, JOB, deps);
    expect(b.overview).toEqual({ error: "TEST accounts can only use active TEST journeys." });
    expect(b.role).toEqual({ error: "TEST accounts can only use active TEST journeys." });
    expect(bundleUsable(b)).toBe(false);
    expect(b.page).toEqual({ jobNumber: "HV-1", boss: true });
    expect(seedPlan(b, JOB).map((s) => s.section)).not.toContain("overview");
  });
});

describe("section errors and the seed plan (pure)", () => {
  test("isSectionError recognises only the { error: string } shape", () => {
    expect(isSectionError(sectionError(new Error("x")))).toBe(true);
    expect(sectionError("plain")).toEqual({ error: "plain" });
    expect(isSectionError({ error: "x", more: 1 })).toBe(false);
    expect(isSectionError({ error: null })).toBe(false);
    expect(isSectionError(null)).toBe(false);
    expect(isSectionError([])).toBe(false);
    expect(isSectionError({ applies: false })).toBe(false);
  });
  test("seedPlan: answered sections only, each under the card's own key; undefined and errors are skipped", () => {
    const plan = seedPlan({ overview: { id: JOB }, role: "installer", page: { error: "x" }, swms: undefined, price: null, mittiInvited: { invited: false } }, JOB);
    expect(plan).toEqual([
      { section: "overview", key: ["job", JOB], data: { id: JOB } },
      { section: "role", key: ["myrole", JOB], data: "installer" },
      { section: "price", key: ["installer-price", JOB], data: null },
      { section: "mittiInvited", key: ["mitti-invited"], data: { invited: false } },
    ]);
  });
  test("every bundle key is the key the card's own useQuery reads (drift guard against the components)", () => {
    const src = (p: string) => readFileSync(p, "utf8");
    const route = src("src/routes/_authenticated/field.$jobId.tsx");
    expect(src("src/components/portal/panels.tsx")).toContain(`queryKey: ["job", jobId]`);
    expect(route).toContain(`queryKey: ["myrole", jobId]`);
    expect(route).toContain(`queryKey: ["trade-job-page", jobId]`);
    expect(route).toContain(`queryKey: ["mitti-invited"]`);
    expect(src("src/components/portal/install-days.tsx")).toContain(`queryKey: ["installer-install-days", jobId]`);
    expect(src("src/components/portal/ready-check-times-installer.tsx")).toContain(`queryKey: ["installer-rc-times", jobId]`);
    expect(src("src/components/trade/visit-allocation.tsx")).toContain(`queryKey: ["visit-allocation", jobId]`);
    expect(src("src/components/trade/SafetyPlanCard.tsx")).toContain(`const key = ["trade-swms", jobId];`);
    expect(src("src/components/portal/workers.tsx")).toContain(`queryKey: ["worker-links", jobId]`);
    expect(src("src/components/trade/InstallerPriceCard.tsx")).toContain(`queryKey: ["installer-price", jobId]`);
    expect(src("src/components/trade/OwnerQuoteCard.tsx")).toContain(`queryKey: ["my-owner-quote", jobId]`);
    expect(BUNDLE_QUERY_KEYS.swms(JOB)).toEqual(["trade-swms", JOB]);
    // Seeded cards must consider a fresh answer fresh, or they would refetch on mount and undo the one-call load.
    for (const p of ["src/components/trade/visit-allocation.tsx", "src/components/trade/SafetyPlanCard.tsx", "src/components/portal/workers.tsx", "src/components/trade/InstallerPriceCard.tsx", "src/components/trade/OwnerQuoteCard.tsx"]) expect(src(p), p).toMatch(/staleTime: 20_000/);
  });
  test("the job page keeps no second cache copy, and a new job remounts the page (final review I3 + remount check)", () => {
    const route = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    // Only the bundle reads/writes the device cache, so its evict/reset cannot be undone by another initialData copy.
    expect(route).not.toContain("job-page:");
    expect(route.match(/initialData:/g)?.length).toBe(1);
    expect(route.match(/writeTradeCache\(/g)?.length).toBe(1);
    expect(route.match(/readTradeCache</g)?.length).toBe(1);
    // /field/A -> /field/B must not reuse A's askedOnce/seeded refs.
    expect(route).toMatch(/createFileRoute\("\/_authenticated\/field\/\$jobId"\)\(\{[\s\S]*?remountDeps: \(\{ params \}\) => params,[\s\S]*?\}\);/);
  });
  test("the server function is a literal chain on the same middleware as getTradeJobPage, and each section reader is the per-section function's own helper", () => {
    const fns = readFileSync("src/lib/trade-view.functions.ts", "utf8");
    expect(fns).toMatch(/export const getTradeJobBundle = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\n\s+\.inputValidator\(\(d\) => z\.object\(\{ jobId: uuid \}\)\.parse\(d\)\)\n\s+\.handler\(/);
    const bundle = readFileSync("src/lib/trade-job-bundle.server.ts", "utf8");
    for (const h of ["jobOverviewFor", "requireTradeJob", "tradeJobPage", "installerInstallDayState", "tradeReadyCheckTimes", "visitAllocationView", "tradeSwms", "workerLinksFor", "installerPriceView", "myOwnerQuoteFor"]) expect(bundle, h).toContain(h);
    expect(readFileSync("src/lib/admin-records.functions.ts", "utf8")).toContain("jobOverviewFor(context.supabase, context.userId, data.jobId)");
    expect(readFileSync("src/lib/worker-links.functions.ts", "utf8")).toContain("workerLinksFor(context.supabase, context.userId, data.jobId)");
    expect(readFileSync("src/lib/installer-quote-status.functions.ts", "utf8")).toContain("myOwnerQuoteFor(");
    // Nothing in the bundle writes or sends.
    expect(bundle.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/logEvent\(|\.insert\(|\.update\(|sendRealSms|sendGuardedOwnerEmail|sendOfficeEmail|testSend/);
  });
});
