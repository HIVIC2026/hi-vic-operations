import { queryOptions } from "@tanstack/react-query";
import { getOperationsJob, getOperationsPreview } from "./operations-preview.functions";

/** One cache for the original preview, canonical categories and actual job status. */
export const operationsOptions = queryOptions({
  queryKey: ["operations-preview"],
  queryFn: () => getOperationsPreview(),
  staleTime: 60_000,
  retry: false,
  refetchOnWindowFocus: false,
});

/** Single-job status read; keyed under the operations-preview prefix so existing
 *  invalidateQueries calls (prefix or invalidate-all) still refresh job status. */
export const operationsJobOptions = (jobId: string) => queryOptions({
  queryKey: ["operations-preview", "job", jobId],
  queryFn: () => getOperationsJob({ data: { jobId } }),
  staleTime: 60_000,
  retry: false,
  refetchOnWindowFocus: false,
});
