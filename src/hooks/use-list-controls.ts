import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listControlsPatch,
  listControlsToSearch,
  parseListControls,
  toPage,
  toPageSize,
  type ListControls,
  type ListSearchSpec,
} from "@/lib/list-paging.core";
import { useDebouncedValue } from "./use-debounced-value";

/**
 * Wires the shared list controls to the URL.
 *
 * The search box updates the moment the office types, but the request only leaves after the debounce,
 * and every change that reshapes the result set returns to page 1 so nobody lands on an empty page.
 * Refresh, a shared link and the back button all restore the same view, because the URL is the state.
 */
export function useListControls(
  input: Partial<ListControls> | null | undefined,
  spec: ListSearchSpec,
  navigate: (search: Record<string, string | number>) => void,
) {
  // A stale caller or initial render may not have supplied URL controls yet.
  // Normalize once for every consumer, not just the search-box initializer.
  const current = useMemo(() => ({
    ...parseListControls({}, spec),
    ...input,
    search: input?.search ?? "",
  }), [input, spec]);
  const [term, setTerm] = useState(current.search);
  const debounced = useDebouncedValue(term, 300);
  const sent = useRef(current.search);
  // Held in a ref so an inline navigate callback cannot restart the debounce effect.
  const go = useRef(navigate);
  go.current = navigate;

  useEffect(() => {
    if (debounced === sent.current) return;
    sent.current = debounced;
    go.current(listControlsToSearch({ ...current, ...listControlsPatch(current, { search: debounced }) }, spec));
  }, [debounced, current, spec]);

  // Refresh, back/forward or "clear filters" all arrive through the URL: refill the box from it.
  useEffect(() => setTerm(current.search), [current.search]);

  const apply = useCallback(
    (patch: Partial<ListControls>) => {
      sent.current = patch.search ?? current.search;
      go.current(listControlsToSearch({ ...current, ...listControlsPatch(current, patch) }, spec));
    },
    [current, spec],
  );

  return {
    current,
    term,
    setTerm,
    apply,
    setPage: (page: number) => apply({ page: toPage(page) }),
    setPageSize: (pageSize: number) => apply({ pageSize: toPageSize(pageSize) }),
    setScope: (scope: string) => apply({ scope }),
    setSort: (sort: string) => apply({ sort }),
    toggleDirection: () => apply({ direction: current.direction === "asc" ? "desc" : "asc" }),
    clear: () => {
      sent.current = "";
      setTerm("");
      apply({ search: "", scope: spec.defaultScope ?? "all" });
    },
  };
}
