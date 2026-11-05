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
import { DEFAULT_VIEW, openingView, parseSavedView, savedViewKey } from "./jobs-saved-view.core"; // speed (portal speed step 2B): the saved-view rules only, not the whole column rulebook
import type { JobsLane } from "./jobs-columns.core";
import type { JobsStage } from "./office-jobs-stage.core";
import { isDefaultListView } from "./office-needs-snapshot.core";
import { enquiriesListKey, installerWaitingKey, jobsListKey } from "./office-list-keys.core";
import { readOfficeList } from "./office-list-refresh";
import { seedLastCopy } from "./office-last-copy";

type Ctx = { queryClient?: QueryClient; user?: { id?: string } } | undefined;
const STALE = 30_000; // as the three pages

// Task 9: the last copy kept on this device for this signed-in user (id from the guarded route context) goes into the
// cache first, so the page draws at once; a seeded list is always asked for again now (staleTime 0) and updates in place.
function start(ctx: Ctx, preload: boolean | undefined, run: (qc: QueryClient, uid: string | undefined) => void): void {
  try {
    if (preload || typeof window === "undefined" || !ctx?.queryClient) return;
    run(ctx.queryClient, ctx.user?.id);
  } catch { /* a head start is only ever a speed-up: the page asks for itself */ }
}

/** Active jobs (`installer`) and Our jobs (`ours`): the view saved in this browser, plus an old link's one-visit ?stage=. */
export function startJobsList(ctx: Ctx, lane: JobsLane, stage: JobsStage | undefined, preload: boolean | undefined): void {
  start(ctx, preload, (qc, uid) => {
    let saved = DEFAULT_VIEW;
    try { saved = parseSavedView(localStorage.getItem(savedViewKey(lane))); } catch { saved = DEFAULT_VIEW; }
    const { view } = openingView(saved, stage);
    const queryKey = jobsListKey(lane, view, "", 1);
    const seeded = seedLastCopy(qc, uid, `jobs:${lane}`, queryKey);
    void qc.prefetchQuery({
      queryKey,
      queryFn: async () => {
        const { getActiveJobsList } = await import("./office-screens.functions");
        const v = { lane, search: "", sort: view.sort, dir: view.dir, page: 1, filters: view.filters, needsUs: view.needsUs, includeTest: false };
        return readOfficeList("jobs", isDefaultListView(v), (refresh) => getActiveJobsList({ data: { ...v, refresh } }));
      },
      staleTime: seeded ? 0 : STALE, retry: 1,
    }).catch(() => undefined);
  });
}

/** Enquiries: the opening category. */
export function startEnquiriesList(ctx: Ctx, preload: boolean | undefined): void {
  start(ctx, preload, (qc, uid) => {
    const view = "offered" as const;
    const queryKey = enquiriesListKey(view, "", {}, { k: "", d: "asc" }, 1);
    const seeded = seedLastCopy(qc, uid, "enquiries", queryKey);
    void qc.prefetchQuery({
      queryKey,
      queryFn: async () => {
        const { getEnquiriesList } = await import("./office-screens.functions");
        const v = { search: "", sort: "", dir: "asc" as const, page: 1, filters: {}, view };
        return readOfficeList("enquiries", isDefaultListView(v), (refresh) => getEnquiriesList({ data: { ...v, refresh } }));
      },
      staleTime: seeded ? 0 : STALE, retry: 1,
    }).catch(() => undefined);
  });
}

/** Choose installer. */
export function startInstallerWaitingList(ctx: Ctx, preload: boolean | undefined): void {
  start(ctx, preload, (qc, uid) => {
    const queryKey = installerWaitingKey(false);
    const seeded = seedLastCopy(qc, uid, "installer-waiting", queryKey);
    void qc.prefetchQuery({
      queryKey,
      queryFn: async () => (await import("./installer-waiting.functions")).getInstallerWaitingList({ data: { includeTest: false } }),
      staleTime: seeded ? 0 : STALE,
    }).catch(() => undefined);
  });
}

/** Portal speed step 2 (Task 5): the office job page — the last copy of THIS job kept on this device for this signed-in
 *  user goes into the page's cache entry first, so a return visit draws at once; the page then asks again (its copy is
 *  older than its staleTime) and keeps its buttons waiting until the fresh answer arrives. */
export const officeJobKey = (jobId: string) => ["office-job-page", jobId] as const;
export const officeJobCopyName = (jobId: string) => `office-job:${jobId}`;
export function startOfficeJob(ctx: Ctx, jobId: string, preload: boolean | undefined): void {
  start(ctx, preload, (qc, uid) => { seedLastCopy(qc, uid, officeJobCopyName(jobId), officeJobKey(jobId)); });
}
