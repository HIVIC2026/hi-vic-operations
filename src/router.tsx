import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// After a new version goes live, an already-open tab can ask for page files that no longer exist.
// Reload once (guarded per 30s) so the tab picks up the current version instead of going blank.
const STALE_KEY = "hiv-stale-reload-at";
const HARD_KEY = "hiv-stale-hard-at";

export const isStaleChunkError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    String((e as Error)?.message ?? e),
  );

function lastReload(key: string): number {
  try {
    return Number(sessionStorage.getItem(key) ?? 0);
  } catch {
    return 0;
  }
}

function stamp(key: string) {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* storage blocked: still recover */
  }
}

// Last resort when reloading is throttled: never leave a blank page.
function showRefreshFallback() {
  if (typeof document === "undefined") return;
  if (document.getElementById("hiv-stale-fallback")) return;
  const wrap = document.createElement("div");
  wrap.id = "hiv-stale-fallback";
  wrap.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#FBFCFA;font-family:Figtree,system-ui,sans-serif;padding:24px;text-align:center";
  wrap.innerHTML =
    '<div style="max-width:360px"><h1 style="font-size:20px;font-weight:600;color:#22376B;margin:0 0 8px">This page needs a refresh</h1>' +
    '<p style="font-size:14px;color:#555;margin:0 0 16px">A newer version of the portal is available. Nothing has been saved or changed.</p>' +
    '<button onclick="window.location.reload()" style="background:#3C51C4;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer">Refresh the page</button></div>';
  document.body.appendChild(wrap);
}

function reloadForNewVersion(): boolean {
  const now = Date.now();
  if (now - lastReload(STALE_KEY) >= 30_000) {
    stamp(STALE_KEY);
    window.location.reload();
    return true;
  }
  // A plain reload already failed moments ago: try one hard navigation that bypasses
  // the cached page, then fall back to an on-screen message instead of a blank screen.
  if (now - lastReload(HARD_KEY) >= 120_000) {
    stamp(HARD_KEY);
    const url = new URL(window.location.href);
    url.searchParams.set("_v", String(now));
    window.location.replace(url.toString());
    return true;
  }
  showRefreshFallback();
  return false;
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (ev) => {
    if (reloadForNewVersion()) ev.preventDefault();
  });
  window.addEventListener("unhandledrejection", (ev) => {
    if (isStaleChunkError(ev.reason)) reloadForNewVersion();
  });
  // A failed <script type="module"> surfaces as an error event, not a rejection.
  window.addEventListener(
    "error",
    (ev) => {
      if (isStaleChunkError(ev.message)) reloadForNewVersion();
    },
    true,
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultOnCatch: (e) => {
      if (typeof window !== "undefined" && isStaleChunkError(e)) reloadForNewVersion();
    },
  });

  return router;
};
