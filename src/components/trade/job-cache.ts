import type { QueryClient } from "@tanstack/react-query";

/** Refresh canonical job readers without replacing local editor state. */
export function refreshInstallerJob(qc: QueryClient, jobId: string) {
  return qc.invalidateQueries({
    predicate: ({ queryKey }) => queryKey.includes(jobId) || queryKey[0] === "trade-home",
  });
}