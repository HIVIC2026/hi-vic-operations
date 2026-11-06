// Hover/touch preloads (defaultPreload "intent") must not reload the tab when a page file is stale after a deploy — that
// could throw away a half-filled form just by moving the mouse. The failure is held and the tab reloads at the next real
// navigation. A failure while a real navigation is loading still reloads at once. Uses a real TanStack router.
import { describe, expect, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { createStaleChunkRecovery } from "../src/lib/stale-chunk-recovery";

function setup() {
  const reloads: string[] = [];
  const prevented: number[] = [];
  let router!: ReturnType<typeof createRouter>;
  const recovery = createStaleChunkRecovery(() => { reloads.push(router.history.location.pathname); return true; /* the address bar, as window.location in the app */ });
  // The page's file fails to load (what vite reports as vite:preloadError), whether preloading or navigating to it.
  const staleFile = () => recovery.onPreloadError({ preventDefault: () => prevented.push(1) });
  const root = createRootRoute();
  const home = createRoute({ getParentRoute: () => root, path: "/" });
  const form = createRoute({ getParentRoute: () => root, path: "/form", loader: () => { staleFile(); return null; } });
  const other = createRoute({ getParentRoute: () => root, path: "/other" });
  router = createRouter({ routeTree: root.addChildren([home, form, other]), history: createMemoryHistory({ initialEntries: ["/"] }), defaultPreloadStaleTime: 0, isServer: false, origin: "https://p.test" });
  recovery.attach(router as never);
  return { router, reloads, prevented };
}

describe("stale page file after a deploy", () => {
  test("a hover/touch preload that hits it does not reload", async () => {
    const { router, reloads, prevented } = setup();
    await router.load();
    await router.preloadRoute({ to: "/form" });
    expect(reloads).toEqual([]);
    expect(prevented).toEqual([]);
    expect(router.state.location.pathname).toBe("/");
  });

  test("…and the next real navigation reloads (once)", async () => {
    const { router, reloads } = setup();
    await router.load();
    await router.preloadRoute({ to: "/form" });
    await router.navigate({ to: "/other" });
    expect(reloads).toEqual(["/other"]);
    await router.navigate({ to: "/" });
    expect(reloads).toEqual(["/other"]);
  });

  test("a real navigation that hits it reloads at once, as before", async () => {
    const { router, reloads, prevented } = setup();
    await router.load();
    await router.navigate({ to: "/form" });
    expect(reloads).toEqual(["/form"]);
    expect(prevented).toEqual([]);
  });

  test("before the router exists (first page load), it reloads as before", () => {
    const reloads: number[] = [];
    const r = createStaleChunkRecovery(() => { reloads.push(1); return true; });
    r.onPreloadError({ preventDefault() {} });
    expect(reloads).toEqual([1]);
  });
  test("a failed import still rejects during recovery instead of resolving an undefined module", async () => {
    const recovery = createStaleChunkRecovery(() => true);
    const missing = new Error("Failed to fetch dynamically imported module");
    let prevented = false;
    // Vite's actual contract: cancelling this event makes its catch resolve undefined.
    const load = Promise.reject(missing).catch(error => {
      recovery.onPreloadError({ preventDefault() { prevented = true; } });
      if (!prevented) throw error;
    });
    await expect(load).rejects.toBe(missing);
  });
});
