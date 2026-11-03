// Speed (portal speed step 1, task 8): an office list's server call starts as soon as its route matches (the route's
// `loader`), while the page code downloads, instead of after the page has mounted.
//
// Same key, same arguments, same retry and freshness as the page's own useQuery, so the page takes the answer that is
// already on its way and never asks twice. Only the opening view is started: the saved view for Active jobs / Our jobs,
// "Offered a spot" for Enquiries, the live list for Choose installer. Nothing here throws into the router and nothing
// waits: if the call fails, the page's own fetch and error screen behave exactly as today. A hover/touch preload is not
// an open page and never starts a call (the opening view can ask the server to work out its saved copy). Every server
// function still checks access itself, and the /admin guard has already run when a loader starts.
// The server call modules are imported when a list opens, not up front, to keep the first download small.
import type { QueryClient } from "@tanstack/react-query";
import { DEFAULT_VIEW, openingView, parseSavedView, savedViewKey, type JobsLane } from "./jobs-columns.core";
import type { JobsStage } from "./office-jobs.core";
import { isDefaultListView } from "./office-needs-snapshot.core";
import { enquiriesListKey, installerWaitingKey, jobsListKey } from "./office-list-keys.core";
import { readOfficeList } from "./office-list-refresh";

type Ctx = { queryClient?: QueryClient } | undefined;
const STALE = 30_000; // as the three pages

function start(ctx: Ctx, preload: boolean | undefined, run: (qc: QueryClient) => void): void {
  try {
    if (preload || typeof window === "undefined" || !ctx?.queryClient) return;
    run(ctx.queryClient);
  } catch { /* a head start is only ever a speed-up: the page asks for itself */ }
}

/** Active jobs (`installer`) and Our jobs (`ours`): the view saved in this browser, plus an old link's one-visit ?stage=. */
export function startJobsList(ctx: Ctx, lane: JobsLane, stage: JobsStage | undefined, preload: boolean | undefined): void {
  start(ctx, preload, (qc) => {
    let saved = DEFAULT_VIEW;
    try { saved = parseSavedView(localStorage.getItem(savedViewKey(lane))); } catch { saved = DEFAULT_VIEW; }
    const { view } = openingView(saved, stage);
    void qc.prefetchQuery({
      queryKey: jobsListKey(lane, view, "", 1),
      queryFn: async () => {
        const { getActiveJobsList } = await import("./office-screens.functions");
        const v = { lane, search: "", sort: view.sort, dir: view.dir, page: 1, filters: view.filters, needsUs: view.needsUs, includeTest: false };
        return readOfficeList("jobs", isDefaultListView(v), (refresh) => getActiveJobsList({ data: { ...v, refresh } }));
      },
      staleTime: STALE, retry: 1,
    }).catch(() => undefined);
  });
}

/** Enquiries: the opening category. */
export function startEnquiriesList(ctx: Ctx, preload: boolean | undefined): void {
  start(ctx, preload, (qc) => {
    const view = "offered" as const;
    void qc.prefetchQuery({
      queryKey: enquiriesListKey(view, "", {}, { k: "", d: "asc" }, 1),
      queryFn: async () => {
        const { getEnquiriesList } = await import("./office-screens.functions");
        const v = { search: "", sort: "", dir: "asc" as const, page: 1, filters: {}, view };
        return readOfficeList("enquiries", isDefaultListView(v), (refresh) => getEnquiriesList({ data: { ...v, refresh } }));
      },
      staleTime: STALE, retry: 1,
    }).catch(() => undefined);
  });
}

/** Choose installer. */
export function startInstallerWaitingList(ctx: Ctx, preload: boolean | undefined): void {
  start(ctx, preload, (qc) => {
    void qc.prefetchQuery({
      queryKey: installerWaitingKey(false),
      queryFn: async () => (await import("./installer-waiting.functions")).getInstallerWaitingList({ data: { includeTest: false } }),
      staleTime: STALE,
    }).catch(() => undefined);
  });
}
