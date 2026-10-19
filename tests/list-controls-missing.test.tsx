import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useListControls } from "../src/hooks/use-list-controls";
import type { ListControls } from "../src/lib/list-paging.core";

afterEach(cleanup);
const spec = { scopeKey: "status", defaultScope: "all" };

test("missing controls initialize a usable enquiry list and support paging", () => {
  const requests: Record<string, string | number>[] = [];
  const { result } = renderHook(() => useListControls(undefined, spec, (s) => requests.push(s)));
  expect(result.current.term).toBe("");
  expect(result.current.current).toEqual({ page: 1, pageSize: 20, search: "", sort: "", direction: "desc", scope: "all" });
  act(() => result.current.setPage(2));
  expect(requests).toEqual([{ page: 2 }]);
  act(() => result.current.setScope("photos"));
  expect(requests[1]).toEqual({ status: "photos" });
});

test("controls arriving after initialization restore search and filters", () => {
  const { result, rerender } = renderHook(
    ({ controls }: { controls: Partial<ListControls> | undefined }) => useListControls(controls, spec, () => {}),
    { initialProps: { controls: undefined } as { controls: Partial<ListControls> | undefined } },
  );
  rerender({ controls: { search: "HV-1234", scope: "photos", page: 3 } });
  expect(result.current.term).toBe("HV-1234");
  expect(result.current.current.scope).toBe("photos");
  expect(result.current.current.page).toBe(3);
});

test("partial controls without search do not propagate undefined", () => {
  const { result } = renderHook(() => useListControls({ page: 2 }, spec, () => {}));
  expect(result.current.term).toBe("");
  expect(result.current.current.search).toBe("");
  expect(result.current.current.page).toBe(2);
});