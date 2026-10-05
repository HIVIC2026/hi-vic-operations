import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// After a new version goes live, an already-open tab can ask for page files that no longer exist.
// Reload once (guarded per 30s) so the tab picks up the current version instead of going blank.
const STALE_KEY = "hiv-stale-reload-at";
function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(STALE_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(STALE_KEY, String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  window.location.reload();
  return true;
}
export const isStaleChunkError = (e: unknown) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String((e as Error)?.message ?? e));

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (ev) => { if (reloadForNewVersion()) ev.preventDefault(); });
  window.addEventListener("unhandledrejection", (ev) => { if (isStaleChunkError(ev.reason)) reloadForNewVersion(); });
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultOnCatch: (e) => { if (typeof window !== "undefined" && isStaleChunkError(e)) reloadForNewVersion(); },
  });

  return router;
};
