// Speed (portal speed step 1, task 9): an installer page draws at once from the last copy on this phone (trade-cache.ts),
// then refreshes in place. Only when the Query cache has nothing for the screen yet (a copy never overrides newer data
// already in memory). The caller passes the signed-in user's id from the route context; copies are per user.
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readTradeCache } from "./trade-cache";

export function useTradeSeed<T>(uid: string | undefined, cacheKey: string, queryKey: readonly unknown[]) {
  const qc = useQueryClient();
  const seed = useMemo(() => {
    if (!uid || qc.getQueryData(queryKey as unknown[]) !== undefined) return null;
    return readTradeCache<T>(uid, cacheKey);
  }, [uid, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps -- read once per screen and person
  return {
    /** Spread into useQuery: the copy as starting data, and always ask again now. */
    options: seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at, refetchOnMount: "always" as const } : {},
    /** True while the data on screen is still the copy from this phone (the fresh one has not arrived). */
    isCopy: (dataUpdatedAt: number) => !!seed && seed.at === dataUpdatedAt,
  };
}
