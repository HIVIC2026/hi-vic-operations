import { queryOptions } from "@tanstack/react-query";
import { getOperationsPreview } from "./operations-preview.functions";

/** One cache for the original preview, canonical categories and actual job status. */
export const operationsOptions = queryOptions({
  queryKey: ["operations-preview"],
  queryFn: () => getOperationsPreview(),
  staleTime: 60_000,
  retry: false,
  refetchOnWindowFocus: false,
});