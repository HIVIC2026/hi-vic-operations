// Speed (installer screens towards 1 second, task 1): which server call each trade screen makes first, under the SAME
// query key and last-copy key its component uses, and whether starting it early (in the route, while the page code
// downloads) is worth it. Pure: no imports. Speed only — the screens' calls, keys, retries and refusals are unchanged.

export type TradeScreen = "home" | "job" | "day" | "business" | "money";
export type TradeScreenParams = { jobId?: string };

export type TradeScreenQuery = {
  screen: TradeScreen;
  /** The component's useQuery key. */
  queryKey: readonly unknown[];
  /** The component's trade-cache key (last copy on this phone). */
  cacheKey: string;
  /** The component's staleTime. */
  staleTime: number;
  /** Whether the component asks again on mount when it already has a stale answer. */
  refetchOnMount: boolean;
};

/** A head start nobody took within this long is dropped (the screen asked for itself, or never opened). */
export const HEAD_START_MS = 10_000;

/** `hasSeed`: a last copy of this screen is on the phone (the job page's freshness depends on it). */
export function tradeScreenQuery(screen: TradeScreen, params: TradeScreenParams, hasSeed: boolean): TradeScreenQuery {
  const jobId = params.jobId ?? "";
  switch (screen) {
    case "home": return { screen, queryKey: ["trade-home"], cacheKey: "home", staleTime: 20_000, refetchOnMount: true };
    // field.$jobId.tsx useTradeJobBundle: a seeded copy is old (asked once on mount); an unseeded answer is kept (Infinity, no remount ask).
    case "job": return { screen, queryKey: ["trade-job-bundle", jobId], cacheKey: `job-bundle:${jobId}`, staleTime: hasSeed ? 0 : Infinity, refetchOnMount: hasSeed };
    case "day": return { screen, queryKey: ["trade-day", jobId], cacheKey: `day:${jobId}`, staleTime: 15_000, refetchOnMount: true };
    case "business": return { screen, queryKey: ["trade-business"], cacheKey: "business", staleTime: 30_000, refetchOnMount: true };
    case "money": return { screen, queryKey: ["trade-money-v2"], cacheKey: "money", staleTime: 30_000, refetchOnMount: true };
  }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JOB_PATH = new RegExp(`^/field/(${UUID})$`, "i");
const DAY_PATH = new RegExp(`^/field/day/(${UUID})$`, "i");

/** The trade screen a /field address opens, or null for every other page (offers, setup, business sub-pages, …). */
export function tradeScreenForPath(pathname: string): { screen: TradeScreen; params: TradeScreenParams } | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/field") return { screen: "home", params: {} };
  if (p === "/field/business") return { screen: "business", params: {} };
  if (p === "/field/money") return { screen: "money", params: {} };
  const day = DAY_PATH.exec(p);
  if (day) return { screen: "day", params: { jobId: day[1]! } };
  const job = JOB_PATH.exec(p);
  if (job) return { screen: "job", params: { jobId: job[1]! } };
  return null;
}

/** What the Query cache holds for the screen's key right now (null = nothing yet). */
export type EarlyQueryState = { hasData: boolean; dataUpdatedAt: number; isInvalidated: boolean; fetching: boolean; observers: number };

/**
 * Start early only when the screen is going to ask the server on mount anyway, so a head start is never an extra call:
 * nothing in memory and no fresh last copy, or a stale/invalidated answer the screen re-asks for. Never while the screen
 * is already showing (it asks for itself) or a fetch is already out.
 */
export function shouldStartEarly(q: TradeScreenQuery, state: EarlyQueryState | null, seedAt: number | null, now: number): boolean {
  if (state) {
    if (state.fetching || state.observers > 0) return false;
    if (!state.hasData) return true; // a failed or empty entry: the screen asks again on mount
    if (!q.refetchOnMount) return false;
    return state.isInvalidated || now - state.dataUpdatedAt >= q.staleTime;
  }
  if (seedAt == null) return true;
  return now - seedAt >= q.staleTime; // the last copy becomes the screen's initial answer: re-asked only once stale
}
