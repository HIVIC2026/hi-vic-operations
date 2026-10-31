// Speed (installer screens towards 1 second, task 1): a trade screen's main server call starts as soon as its route
// matches — in the route's `loader`, and even earlier in the trade area's guard, alongside the role reads — so it runs
// while the page code downloads instead of after the page has drawn.
//
// Why a head start and not `queryClient.prefetchQuery`: a prefetch would create the Query entry before the screen
// mounts, so the screen's last-copy seed (`initialData` from trade-cache) would be ignored and the job page's
// seed/evict bookkeeping (field.$jobId.tsx) would run against a copy it never seeded. Here the loader only starts the
// SAME call with the SAME arguments; the screen's own useQuery (same key, same queryFn, same retries, same error UI)
// takes that promise for its first fetch via `headStartOr`. A refusal reaches the screen as the same error, exactly as
// today. Nothing is written to the Query cache here, and nothing here ever throws into the router.
// Every server function still checks access itself.
import type { QueryClient } from "@tanstack/react-query";
import * as trade from "./trade-view.functions";
import { readTradeCache } from "./trade-cache";
import { HEAD_START_MS, shouldStartEarly, tradeScreenForPath, tradeScreenQuery, type TradeScreen, type TradeScreenParams } from "./trade-route-prefetch.core";

/** Each screen's first call, exactly as its component makes it. */
const CALLS: Record<TradeScreen, (p: TradeScreenParams) => Promise<unknown>> = {
  home: () => trade.getTradeHome(),
  job: (p) => trade.getTradeJobBundle({ data: { jobId: p.jobId! } }),
  day: (p) => trade.getTradeDayView({ data: { jobId: p.jobId! } }),
  business: () => trade.getTradeBusiness(),
  money: () => trade.getTradeMoneyView(),
};

type Early = { uid: string; at: number; promise: Promise<unknown> };
const early = new Map<string, Early>();
const keyOf = (queryKey: readonly unknown[]) => JSON.stringify(queryKey);

/** Sign-out (and tests): drop every head start. */
export function forgetHeadStarts(): void { early.clear(); }

function sweep(now: number) {
  for (const [k, e] of early) if (now - e.at > HEAD_START_MS) early.delete(k);
}

// Only the FIRST fetch for a key may take its head start. Query dispatches "fetch" before calling the queryFn (which
// takes the entry), so when a fetch for that key finishes ("success"/"error", incl. setQueryData) and the entry is
// still there, that fetch did not take it — drop it, so a later refetch (after an action, a poll) can never get an
// answer from before.
const watched = new WeakSet<QueryClient>();
function watch(qc: QueryClient) {
  if (watched.has(qc)) return;
  watched.add(qc);
  qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== "updated") return;
    const t = (ev.action as { type?: string }).type;
    if (t === "success" || t === "error") early.delete(keyOf(ev.query.queryKey));
  });
}

type LoaderContext = { queryClient?: QueryClient; user?: { id?: string } } | undefined;

/** Route loader: start this screen's call now if the screen will ask for it on mount. Never throws, never blocks. */
export function startTradeScreen(context: LoaderContext, screen: TradeScreen, params: TradeScreenParams, preload: boolean | undefined): void {
  try {
    if (preload) return; // a hover/intent preload is not an open screen
    const uid = context?.user?.id;
    const qc = context?.queryClient;
    if (!uid || !qc) return;
    const now = Date.now();
    sweep(now);
    watch(qc);
    const seed = readTradeCache<unknown>(uid, tradeScreenQuery(screen, params, false).cacheKey);
    const q = tradeScreenQuery(screen, params, !!seed);
    const k = keyOf(q.queryKey);
    const pending = early.get(k);
    if (pending && pending.uid === uid && now - pending.at <= HEAD_START_MS) return; // already started (trade area, then loader)
    const query = qc.getQueryCache().find({ queryKey: [...q.queryKey], exact: true });
    const state = query ? { hasData: query.state.data !== undefined, dataUpdatedAt: query.state.dataUpdatedAt, isInvalidated: query.state.isInvalidated, fetching: query.state.fetchStatus === "fetching", observers: query.getObserversCount() } : null;
    if (!shouldStartEarly(q, state, seed?.at ?? null, now)) return;
    const promise = CALLS[screen](params);
    promise.catch(() => undefined); // the screen surfaces the error when it takes the promise; never an unhandled rejection
    early.set(k, { uid, at: now, promise });
  } catch { /* a head start is only ever a speed-up: the screen asks for itself */ }
}

/** Trade area guard: start the screen this address opens (before the role reads), if it is one of the five. */
export function startTradeScreenForPath(context: LoaderContext, pathname: string, preload: boolean | undefined): void {
  const s = tradeScreenForPath(pathname);
  if (s) startTradeScreen(context, s.screen, s.params, preload);
}

/** In the screen's queryFn: the started call for this person and key if there is a fresh one (taken once), else `call()`. */
export function headStartOr<T>(uid: string, queryKey: readonly unknown[], call: () => Promise<T>): Promise<T> {
  const k = keyOf(queryKey);
  const e = early.get(k);
  early.delete(k);
  sweep(Date.now());
  if (e && e.uid === uid && Date.now() - e.at <= HEAD_START_MS) return e.promise as Promise<T>;
  return call();
}
