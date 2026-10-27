import type { Query, QueryClient } from "@tanstack/react-query";

/** The readers a job's actions can change: every query keyed by that job id, trade home, and any named extras. */
export function jobQueries(jobId: string, also: readonly string[] = []) {
  return { predicate: ({ queryKey }: Query) => queryKey.includes(jobId) || queryKey[0] === "trade-home" || also.includes(String(queryKey[0])) };
}

/** The Money page's readers: recording the install changes what the trade is paid. */
export const TRADE_MONEY_QUERIES = ["trade-money-v2", "trade-money-extras"] as const;

/** Refresh canonical job readers without replacing local editor state. */
export function refreshInstallerJob(qc: QueryClient, jobId: string) {
  return qc.invalidateQueries(jobQueries(jobId));
}

/** What to re-read after a successful action: everything (office default), nothing, or one job's readers (trade pages:
 *  every query keyed by that job id + trade home + any named extras the action also changes). */
export type ActionRefresh = boolean | { jobId: string; also?: readonly string[] };

/** Speed (trade buttons, Jo 28 Oct 2026): the refresh runs in the background — the button never waits for it. */
export function refreshInBackground(qc: QueryClient, refresh: ActionRefresh = true) {
  if (refresh === false) return;
  const filters = refresh === true ? undefined : jobQueries(refresh.jobId, refresh.also);
  void Promise.resolve(qc.invalidateQueries(filters)).catch(() => undefined);
}
