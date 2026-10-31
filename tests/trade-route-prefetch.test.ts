// Speed (installer screens towards 1 second, task 1): each trade screen's main server call starts as soon as the route
// matches, while the page code is still downloading, and the screen-only sign-in guard reads the session saved on the
// phone instead of asking the auth server first. Speed only: same calls, same query keys, same refusals, same /auth
// redirect for signed-out people. Only the transport is stubbed (router, server functions, Supabase client).
import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";

const JOB = "00000000-0000-4000-8000-000000000c01";
const UID = "00000000-0000-4000-8000-0000000000a1";

// --- localStorage (trade-cache reads it) ---
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
};

// --- server functions: every call is recorded, the answer is controlled per test ---
const calls: { name: string; args: unknown }[] = [];
let answer: (name: string) => Promise<unknown> = async (name) => ({ from: name });
const fake = (name: string) => (args?: unknown) => { calls.push({ name, args }); return answer(name); };
mock.module("@/lib/trade-view.functions", () => ({
  getTradeHome: fake("getTradeHome"), getTradeJobBundle: fake("getTradeJobBundle"), getTradeDayView: fake("getTradeDayView"),
  getTradeBusiness: fake("getTradeBusiness"), getTradeMoneyView: fake("getTradeMoneyView"),
}));

// --- router ---
type Redirect = { redirect: { to: string; search?: unknown } };
mock.module("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (opts: Record<string, unknown>) => ({ ...opts, options: opts, path }),
  redirect: (o: { to: string; search?: unknown }): Redirect => ({ redirect: o }),
  Outlet: () => null,
}));

// --- Supabase client: the saved session, the auth server and the two role reads are controlled per test ---
type UserLike = { id: string; email?: string; email_confirmed_at?: string };
let session: { user: UserLike } | null = null;
let networkUser: () => Promise<{ data: { user: UserLike | null }; error: unknown }> = async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } });
const auth = { getSession: 0, getUser: 0, signOut: [] as unknown[] };
let authListener: ((event: string) => void) | null = null;
// The guards register their auth-change listener only in a browser.
(globalThis as { window?: unknown }).window ??= globalThis;
const replaced: string[] = [];
(globalThis as { location?: unknown }).location = { pathname: "/field", search: "", hash: "", origin: "https://p.test", replace: (u: string) => void replaced.push(u) };
let roleRows: () => Promise<{ data: { role: string }[] | null }> = async () => ({ data: [{ role: "installer" }] });
const rows = (p: () => Promise<unknown>) => { const c: Record<string, unknown> = {}; c.select = () => c; c.eq = () => c; c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => p().then(ok, bad); return c; };
mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (fn: (event: string) => void) => { authListener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async (o: unknown) => { auth.signOut.push(o); session = null; authListener?.("SIGNED_OUT"); return { error: null }; },
      getSession: async () => { auth.getSession++; return { data: { session }, error: null }; },
      getUser: () => { auth.getUser++; return networkUser(); },
    },
    from: (t: string) => rows(t === "user_roles" ? () => roleRows() : async () => ({ data: [] })),
  },
}));

const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
const core = await import("../src/lib/trade-route-prefetch.core");
const pre = await import("../src/lib/trade-route-prefetch");
const guards = await import("../src/lib/route-guards");
const { readTradeCache, writeTradeCache, resetTradeCacheSignOut } = await import("../src/lib/trade-cache");

const ctx = (qc = new QueryClient()) => ({ queryClient: qc, user: { id: UID } });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0; mem.clear(); resetTradeCacheSignOut(); pre.forgetHeadStarts(); guards.forgetGuardMemo();
  answer = async (name) => ({ from: name });
  session = null; auth.getSession = 0; auth.getUser = 0; auth.signOut = []; replaced.length = 0;
  networkUser = async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } });
  roleRows = async () => ({ data: [{ role: "installer" }] });
});
afterEach(() => setSystemTime());

describe("which call each trade screen starts (same keys the screens use)", () => {
  test("query keys and trade-cache keys match the components", () => {
    expect(core.tradeScreenQuery("home", {}, false).queryKey).toEqual(["trade-home"]);
    expect(core.tradeScreenQuery("job", { jobId: JOB }, false).queryKey).toEqual(["trade-job-bundle", JOB]);
    expect(core.tradeScreenQuery("day", { jobId: JOB }, false).queryKey).toEqual(["trade-day", JOB]);
    expect(core.tradeScreenQuery("business", {}, false).queryKey).toEqual(["trade-business"]);
    expect(core.tradeScreenQuery("money", {}, false).queryKey).toEqual(["trade-money-v2"]);
    expect(core.tradeScreenQuery("home", {}, false).cacheKey).toBe("home");
    expect(core.tradeScreenQuery("job", { jobId: JOB }, false).cacheKey).toBe(`job-bundle:${JOB}`);
    expect(core.tradeScreenQuery("day", { jobId: JOB }, false).cacheKey).toBe(`day:${JOB}`);
    expect(core.tradeScreenQuery("business", {}, false).cacheKey).toBe("business");
    expect(core.tradeScreenQuery("money", {}, false).cacheKey).toBe("money");
  });
  test("the job bundle's freshness follows the page: a seeded copy is asked once, an unseeded answer is kept", () => {
    expect(core.tradeScreenQuery("job", { jobId: JOB }, true)).toMatchObject({ staleTime: 0, refetchOnMount: true });
    expect(core.tradeScreenQuery("job", { jobId: JOB }, false)).toMatchObject({ staleTime: Infinity, refetchOnMount: false });
    expect(core.tradeScreenQuery("home", {}, false)).toMatchObject({ staleTime: 20_000, refetchOnMount: true });
    expect(core.tradeScreenQuery("day", { jobId: JOB }, false)).toMatchObject({ staleTime: 15_000, refetchOnMount: true });
    expect(core.tradeScreenQuery("business", {}, false)).toMatchObject({ staleTime: 30_000, refetchOnMount: true });
    expect(core.tradeScreenQuery("money", {}, false)).toMatchObject({ staleTime: 30_000, refetchOnMount: true });
  });
  test("the trade address picks the screen; every other trade page starts nothing", () => {
    expect(core.tradeScreenForPath("/field")).toEqual({ screen: "home", params: {} });
    expect(core.tradeScreenForPath("/field/")).toEqual({ screen: "home", params: {} });
    expect(core.tradeScreenForPath(`/field/${JOB}`)).toEqual({ screen: "job", params: { jobId: JOB } });
    expect(core.tradeScreenForPath(`/field/day/${JOB}`)).toEqual({ screen: "day", params: { jobId: JOB } });
    expect(core.tradeScreenForPath("/field/business")).toEqual({ screen: "business", params: {} });
    expect(core.tradeScreenForPath("/field/money")).toEqual({ screen: "money", params: {} });
    for (const p of ["/field/business/team", `/field/money/${JOB}`, `/field/offer/${JOB}`, "/field/guide", "/field/welcome", "/field/setup", `/field/run/${JOB}`, "/partner", "/home"])
      expect(core.tradeScreenForPath(p)).toBeNull();
  });
});

describe("shouldStartEarly: only when the screen is going to ask the server on mount anyway", () => {
  const home = core.tradeScreenQuery("home", {}, false);
  const now = 1_000_000;
  const st = (o: Partial<core.EarlyQueryState>): core.EarlyQueryState => ({ hasData: false, dataUpdatedAt: 0, isInvalidated: false, fetching: false, observers: 0, ...o });
  test("nothing on the phone: start", () => expect(core.shouldStartEarly(home, null, null, now)).toBe(true));
  test("a last copy younger than the screen's freshness: the screen won't ask, so don't start", () => expect(core.shouldStartEarly(home, null, now - 5_000, now)).toBe(false));
  test("an old last copy: start", () => expect(core.shouldStartEarly(home, null, now - 25_000, now)).toBe(true));
  test("already fetching or already on screen: never start a second call", () => {
    expect(core.shouldStartEarly(home, st({ fetching: true }), null, now)).toBe(false);
    expect(core.shouldStartEarly(home, st({ observers: 1, hasData: true, dataUpdatedAt: 0 }), null, now)).toBe(false);
  });
  test("an answer in memory: start only when stale or invalidated", () => {
    expect(core.shouldStartEarly(home, st({ hasData: true, dataUpdatedAt: now - 1_000 }), null, now)).toBe(false);
    expect(core.shouldStartEarly(home, st({ hasData: true, dataUpdatedAt: now - 1_000, isInvalidated: true }), null, now)).toBe(true);
    expect(core.shouldStartEarly(home, st({ hasData: true, dataUpdatedAt: now - 21_000 }), null, now)).toBe(true);
  });
  test("a failed answer in memory (no data): start, the screen asks again on mount", () => expect(core.shouldStartEarly(home, st({ hasData: false }), now - 1_000, now)).toBe(true));
  test("job bundle without a last copy and an answer in memory: the page never re-asks, so don't start", () => {
    const job = core.tradeScreenQuery("job", { jobId: JOB }, false);
    expect(core.shouldStartEarly(job, st({ hasData: true, dataUpdatedAt: 0, isInvalidated: true }), null, now)).toBe(false);
    const seeded = core.tradeScreenQuery("job", { jobId: JOB }, true);
    expect(core.shouldStartEarly(seeded, null, now - 1, now)).toBe(true);
  });
});

describe("head start: the loader starts the call, the screen's own query uses it", () => {
  test("the call starts in the loader, before anything renders, with the screen's own arguments", () => {
    pre.startTradeScreen(ctx(), "home", {}, false);
    pre.startTradeScreen(ctx(), "job", { jobId: JOB }, false);
    pre.startTradeScreen(ctx(), "day", { jobId: JOB }, false);
    pre.startTradeScreen(ctx(), "business", {}, false);
    pre.startTradeScreen(ctx(), "money", {}, false);
    expect(calls).toEqual([
      { name: "getTradeHome", args: undefined }, { name: "getTradeJobBundle", args: { data: { jobId: JOB } } },
      { name: "getTradeDayView", args: { data: { jobId: JOB } } }, { name: "getTradeBusiness", args: undefined }, { name: "getTradeMoneyView", args: undefined },
    ]);
  });
  test("the screen's query takes the started call: ONE server call in total, same answer", async () => {
    const qc = new QueryClient();
    pre.startTradeScreen(ctx(qc), "home", {}, false);
    let own = 0;
    const data = await qc.fetchQuery({ queryKey: ["trade-home"], queryFn: () => pre.headStartOr(UID, ["trade-home"], async () => { own++; return { own: true }; }) });
    expect(data).toEqual({ from: "getTradeHome" });
    expect(own).toBe(0);
    expect(calls.length).toBe(1);
  });
  test("taken once only: the next fetch (poll, action refresh, retry) asks the server itself", async () => {
    pre.startTradeScreen(ctx(), "home", {}, false);
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toEqual({ from: "getTradeHome" });
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toBe("own");
  });
  test("only the FIRST fetch may take it: a fetch that finished without taking it drops it (no pre-action answer later)", async () => {
    const qc = new QueryClient();
    pre.startTradeScreen(ctx(qc), "business", {}, false);
    // another page sharing the key (guide/team) fetches it its own way
    await qc.fetchQuery({ queryKey: ["trade-business"], queryFn: async () => "team page" });
    // a later refetch (e.g. after an action) asks the server itself
    expect(await pre.headStartOr(UID, ["trade-business"], async () => "own")).toBe("own");
  });
  test("an error that finished without taking it drops it too", async () => {
    const qc = new QueryClient();
    pre.startTradeScreen(ctx(qc), "home", {}, false);
    await qc.fetchQuery({ queryKey: ["trade-home"], queryFn: async () => { throw new Error("x"); }, retry: false }).catch(() => undefined);
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toBe("own");
  });
  test("expired head starts are swept on the next start, not kept in memory", async () => {
    setSystemTime(new Date("2026-10-31T00:00:00Z"));
    const qc = new QueryClient();
    pre.startTradeScreen(ctx(qc), "home", {}, false);
    setSystemTime(new Date(Date.parse("2026-10-31T00:00:00Z") + core.HEAD_START_MS + 1));
    pre.startTradeScreen(ctx(qc), "money", {}, false); // sweeps the old home entry
    setSystemTime(new Date("2026-10-31T00:00:00Z")); // even if the clock went back, the swept entry is gone
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toBe("own");
  });
  test("another person's head start is never used", async () => {
    pre.startTradeScreen(ctx(), "home", {}, false);
    expect(await pre.headStartOr("someone-else", ["trade-home"], async () => "own")).toBe("own");
  });
  test("an old head start (the screen never asked) is dropped", async () => {
    setSystemTime(new Date("2026-10-31T00:00:00Z"));
    pre.startTradeScreen(ctx(), "home", {}, false);
    setSystemTime(new Date(Date.parse("2026-10-31T00:00:00Z") + core.HEAD_START_MS + 1));
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toBe("own");
  });
  test("a refusal reaches the screen as the same error, and never as an unhandled rejection or a thrown loader", async () => {
    answer = async () => { throw new Error("This job isn't assigned to you."); };
    expect(() => pre.startTradeScreen(ctx(), "job", { jobId: JOB }, false)).not.toThrow();
    await tick(); // nothing awaits it yet: must not surface as an unhandled rejection
    await expect(pre.headStartOr(UID, ["trade-job-bundle", JOB], async () => "own")).rejects.toThrow("This job isn't assigned to you.");
  });
  test("a loader that cannot work (no signed-in id, storage throws) starts nothing and never throws", () => {
    expect(() => pre.startTradeScreen({ queryClient: new QueryClient() }, "home", {}, false)).not.toThrow();
    expect(() => pre.startTradeScreen(undefined, "home", {}, false)).not.toThrow();
    expect(calls.length).toBe(0);
  });
  test("hover preloads start nothing", () => {
    pre.startTradeScreen(ctx(), "home", {}, true);
    expect(calls.length).toBe(0);
  });
  test("the screen already showing (an observer) or already fetching: no second call", async () => {
    const qc = new QueryClient();
    const obs = new QueryObserver(qc, { queryKey: ["trade-home"], queryFn: async () => "own", staleTime: 20_000 });
    const off = obs.subscribe(() => undefined);
    await tick();
    pre.startTradeScreen(ctx(qc), "home", {}, false);
    expect(calls.length).toBe(0);
    off();
  });
  test("a fresh last copy on the phone (the screen won't ask on mount): no call", () => {
    writeTradeCache(UID, "home", { cached: true });
    pre.startTradeScreen(ctx(), "home", {}, false);
    expect(calls.length).toBe(0);
  });
  test("started twice (the trade area and the screen's own loader): one call", () => {
    const c = ctx();
    pre.startTradeScreenForPath(c, "/field/money", false);
    pre.startTradeScreen(c, "money", {}, false);
    expect(calls).toEqual([{ name: "getTradeMoneyView", args: undefined }]);
  });
  test("sign-out forgets every head start", async () => {
    pre.startTradeScreen(ctx(), "home", {}, false);
    pre.forgetHeadStarts();
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toBe("own");
  });
});

describe("screen-only sign-in guard prefers the saved session", () => {
  test("a saved session answers without waiting on the auth server", async () => {
    session = { user: { id: UID, email: "a@b.c" } };
    networkUser = () => new Promise(() => undefined); // the auth server never answers
    const r = await guards.currentUser();
    expect(r.data.user?.id).toBe(UID);
    expect(r.error).toBeNull();
    expect(auth.getSession).toBe(1);
  });
  test("no saved session: falls back to the auth server", async () => {
    session = null;
    networkUser = async () => ({ data: { user: { id: UID } }, error: null });
    const r = await guards.currentUser();
    expect(r.data.user?.id).toBe(UID);
    expect(auth.getUser).toBe(1);
  });
  test("the answer is still remembered briefly and forgotten on an auth change", async () => {
    session = { user: { id: UID } };
    await guards.currentUser(); await guards.currentUser();
    expect(auth.getSession).toBe(1);
    guards.forgetGuardMemo();
    await guards.currentUser();
    expect(auth.getSession).toBe(2);
  });
  test("the auth server refusing the saved session (403, e.g. banned/deleted): signed out on this phone at once, then /auth", async () => {
    session = { user: { id: UID } };
    writeTradeCache(UID, "home", { live: true });
    pre.startTradeScreen(ctx(), "home", {}, false);
    networkUser = async () => ({ data: { user: null }, error: { name: "AuthApiError", status: 403 } });
    const first = await guards.currentUser();
    expect(first.data.user?.id).toBe(UID); // the screen may start from the saved session…
    await tick(); await tick();
    // …but the background refusal signs out locally without waiting for another navigation (SIGNED_OUT drives the redirect)
    expect(auth.signOut).toEqual([{ scope: "local" }]);
    expect(readTradeCache(UID, "home")).toBeNull();
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "own")).toBe("own");
    // then a full reload of /auth (nothing of this person survives in memory), coming back here after sign-in
    expect(replaced).toEqual(["/auth?next=%2Ffield"]);
    // and the signed-in guard sends them to /auth too
    const R = (await import("../src/routes/_authenticated/route")).Route as unknown as { options: { beforeLoad: (a: unknown) => Promise<unknown> } };
    const thrown = await R.options.beforeLoad({ location: { href: "/field" } }).then(() => null, (e: unknown) => e);
    expect(thrown).toEqual({ redirect: { to: "/auth", search: { next: "/field" } } });
  });
  test("a 401 refusal also signs out locally", async () => {
    session = { user: { id: UID } };
    networkUser = async () => ({ data: { user: null }, error: { name: "AuthApiError", status: 401 } });
    await guards.currentUser();
    await tick(); await tick();
    expect(auth.signOut).toEqual([{ scope: "local" }]);
  });
  test("sign-out (SIGNED_OUT) forgets every head start; other auth events don't", async () => {
    pre.startTradeScreen(ctx(), "home", {}, false);
    authListener?.("TOKEN_REFRESHED");
    pre.startTradeScreen(ctx(), "money", {}, false);
    authListener?.("SIGNED_OUT");
    expect(await pre.headStartOr(UID, ["trade-money-v2"], async () => "own")).toBe("own");
    expect(authListener).not.toBeNull();
  });
  test("a network failure of the background check does not sign anyone out", async () => {
    session = { user: { id: UID } };
    networkUser = async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    await guards.currentUser();
    await tick(); await tick();
    expect((await guards.currentUser()).data.user?.id).toBe(UID);
    expect(auth.signOut).toEqual([]);
    expect(replaced).toEqual([]);
  });
});

describe("signed-in area and trade area guards", () => {
  const authRoute = async () => (await import("../src/routes/_authenticated/route")).Route as unknown as { options: { beforeLoad: (a: unknown) => Promise<unknown> } };
  const fieldRoute = async () => (await import("../src/routes/_authenticated/field")).Route as unknown as { options: { beforeLoad: (a: unknown) => Promise<unknown> } };
  test("signed out: still sent to /auth with the page to come back to", async () => {
    session = null;
    const R = await authRoute();
    const thrown = await R.options.beforeLoad({ location: { href: "/field/money" } }).then(() => null, (e: unknown) => e);
    expect(thrown).toEqual({ redirect: { to: "/auth", search: { next: "/field/money" } } });
  });
  test("signed in on this phone: the user is in context without an auth-server round trip first", async () => {
    session = { user: { id: UID } };
    networkUser = () => new Promise(() => undefined);
    const R = await authRoute();
    expect(await R.options.beforeLoad({ location: { href: "/field" } })).toEqual({ user: { id: UID } });
  });
  test("the trade area starts the screen's call alongside the role reads, not after them", async () => {
    let release!: () => void;
    roleRows = () => new Promise((ok) => { release = () => ok({ data: [{ role: "installer" }] }); });
    const R = await fieldRoute();
    const done = R.options.beforeLoad({ context: ctx(), location: { pathname: `/field/day/${JOB}` } });
    await tick();
    expect(calls).toEqual([{ name: "getTradeDayView", args: { data: { jobId: JOB } } }]); // started while the role reads are still out
    release();
    await expect(done).resolves.toBeUndefined();
  });
  test("a preload of a trade address starts nothing", async () => {
    const R = await fieldRoute();
    await R.options.beforeLoad({ context: ctx(), location: { pathname: "/field" }, preload: true });
    expect(calls).toEqual([]);
  });
  test("not a trade (an owner): still sent to /home", async () => {
    roleRows = async () => ({ data: [{ role: "owner" }] });
    const R = await fieldRoute();
    const thrown = await R.options.beforeLoad({ context: ctx(), location: { pathname: "/field" } }).then(() => null, (e: unknown) => e);
    expect(thrown).toEqual({ redirect: { to: "/home" } });
  });
});

describe("source pins: every listed route declares the loader for its own screen query", () => {
  const routes = [
    { file: "field.index.tsx", screen: "home", key: '["trade-home"]' },
    { file: "field.$jobId.tsx", screen: "job", key: '["trade-job-bundle", jobId]' },
    { file: "field.day.$jobId.tsx", screen: "day", key: '["trade-day", jobId]' },
    { file: "field.business.tsx", screen: "business", key: '["trade-business"]' },
    { file: "field.money.tsx", screen: "money", key: '["trade-money-v2"]' },
  ] as const;
  for (const r of routes) {
    test(`${r.file}: loader starts "${r.screen}" and the screen's query takes it under ${r.key}`, () => {
      const src = readFileSync(`src/routes/_authenticated/${r.file}`, "utf8");
      expect(src).toMatch(new RegExp(`loader: \\(\\{ context, params, preload \\}\\) => startTradeScreen\\(context, "${r.screen}", params, preload\\)`));
      expect(src).toContain(`queryKey: ${r.key}`);
      const take = r.screen === "job" ? "headStartOr(uid, queryKey, " : `headStartOr(uid, ${r.key}, `;
      expect(src).toContain(take);
      // the core's key for this screen is the component's key
      const literal = JSON.parse(r.key.replace("jobId", `"${JOB}"`));
      expect(core.tradeScreenQuery(r.screen, { jobId: JOB }, false).queryKey).toEqual(literal);
    });
  }
  test("the job page keeps its seeding, evict-on-refusal and remount rules", () => {
    const src = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(src).toContain("remountDeps: ({ params }) => params");
    expect(src).toContain("catch (e) { if (seed) evict(null); throw e; }");
    expect(src).toContain("if (seed) evict(bundle);");
    expect(src).toContain("if (prev && (askedOnce.current || !seed)) return prev;");
  });
  test("the trade area starts the screen before awaiting the role reads; the guard condition is unchanged", () => {
    const src = readFileSync("src/routes/_authenticated/field.tsx", "utf8");
    expect(src.indexOf("startTradeScreenForPath(")).toBeGreaterThan(-1);
    expect(src.indexOf("startTradeScreenForPath(")).toBeLessThan(src.indexOf("await loadAccess("));
    expect(src).toContain("startTradeScreenForPath(context, location.pathname, preload)");
    expect(src).toContain("if (!(a.admin || a.installer || a.electrician)) throw redirect({ to: \"/home\" });");
  });
});

describe("sign-out clears everything of the signed-out person in this tab (no cross-user answers)", () => {
  const B = "00000000-0000-4000-8000-0000000000b2";
  test("SIGNED_OUT: no query data remains, last copies and head starts are gone, and the next person's first render has none of it", async () => {
    const { refreshForAuthChange } = await import("../src/lib/auth-change");
    const qc = new QueryClient();
    qc.setQueryData(["trade-home"], { jobs: ["A's job"] });
    qc.setQueryData(["trade-job-bundle", JOB], { overview: { owner: "A's owner" } });
    writeTradeCache(UID, "home", { jobs: ["A's job"] });
    pre.startTradeScreen(ctx(qc), "money", {}, false);
    let invalidated = 0;
    refreshForAuthChange("SIGNED_OUT", { invalidate: () => { invalidated++; } }, qc);
    expect(qc.getQueryCache().getAll()).toEqual([]);
    expect(readTradeCache(UID, "home")).toBeNull();
    expect(await pre.headStartOr(UID, ["trade-money-v2"], async () => "own")).toBe("own");
    expect(invalidated).toBe(1);
    // B signs in in the same tab (no reload): B's home screen starts with nothing from A
    const obs = new QueryObserver(qc, { queryKey: ["trade-home"], queryFn: async () => ({ jobs: ["B's job"] }), enabled: false });
    expect(obs.getCurrentResult().data).toBeUndefined();
    expect(qc.getQueryData(["trade-job-bundle", JOB])).toBeUndefined();
    void B;
  });
  test("SIGNED_IN / USER_UPDATED keep today's refresh: router invalidated and every query invalidated, nothing cleared", async () => {
    const { refreshForAuthChange } = await import("../src/lib/auth-change");
    const qc = new QueryClient();
    qc.setQueryData(["me"], { id: UID });
    let invalidated = 0;
    refreshForAuthChange("SIGNED_IN", { invalidate: () => { invalidated++; } }, qc);
    expect(invalidated).toBe(1);
    expect(qc.getQueryData(["me"])).toEqual({ id: UID });
    expect(qc.getQueryState(["me"])?.isInvalidated).toBe(true);
    refreshForAuthChange("TOKEN_REFRESHED", { invalidate: () => { invalidated++; } }, qc);
    expect(invalidated).toBe(1);
  });
  test("the root listener uses it", () => {
    const src = readFileSync("src/routes/__root.tsx", "utf8");
    expect(src).toContain("refreshForAuthChange(event, router, queryClient)");
  });
});

describe("a head start asked before an action is never shown after it", () => {
  test("an invalidation (an action finished) drops every head start, even with the target screen not showing", async () => {
    const qc = new QueryClient();
    setSystemTime(new Date("2026-10-31T00:00:00Z"));
    qc.setQueryData(["trade-home"], { before: true });
    setSystemTime(new Date(Date.parse("2026-10-31T00:00:00Z") + 30_000)); // stale: the screen will ask on mount
    pre.startTradeScreen(ctx(qc), "home", {}, false);
    expect(calls.length).toBe(1);
    await qc.invalidateQueries(); // useAction after the action returns
    expect(await pre.headStartOr(UID, ["trade-home"], async () => "fresh after the action")).toBe("fresh after the action");
  });
  test("an invalidation of any other query also drops it (the target screen has no entry yet)", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["job", JOB], { x: 1 });
    pre.startTradeScreen(ctx(qc), "day", { jobId: JOB }, false);
    await qc.invalidateQueries({ queryKey: ["job", JOB] });
    expect(await pre.headStartOr(UID, ["trade-day", JOB], async () => "own")).toBe("own");
  });
  test("useAction forgets head starts after every action, success or failure", () => {
    const src = readFileSync("src/hooks/use-me.ts", "utf8");
    const body = src.slice(src.indexOf("export function useAction"), src.indexOf("export function useAccess"));
    expect(body.indexOf("forgetHeadStarts();")).toBeGreaterThan(body.indexOf("await call({ data })"));
    expect(body.indexOf("forgetHeadStarts();", body.indexOf("catch (e)"))).toBeGreaterThan(-1);
  });
});
