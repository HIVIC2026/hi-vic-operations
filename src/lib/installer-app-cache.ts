// Browser side of the installer app cache (rules and the switch in installer-app-cache.core). Called from the /field
// layout route only. Never throws: a worker is only ever a speed-up for return visits; the page works without it.
import { CACHE_PREFIX, SERVICE_WORKER_ENABLED, SW_PATH, SW_SCOPE, appCachePlan } from "./installer-app-cache.core";

let done = false;
export function registerInstallerAppCache(): void {
  if (done) return; // once per page load
  done = true;
  try {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const supported = !!nav && "serviceWorker" in nav && typeof window !== "undefined" && window.isSecureContext;
    const production = !!(import.meta as { env?: { PROD?: boolean } }).env?.PROD;
    const plan = appCachePlan({ enabled: SERVICE_WORKER_ENABLED, supported, production, pathname: typeof location !== "undefined" ? location.pathname : "" });
    if (plan === "register") {
      void nav!.serviceWorker.register(SW_PATH, { scope: SW_SCOPE }).catch(() => undefined);
    } else if (plan === "unregister") {
      // The switch was turned off after being on: remove the worker and its caches so the phone is as it was.
      void nav!.serviceWorker.getRegistrations().then(async (regs) => {
        const ours = regs.filter((r) => new URL(r.scope).pathname.replace(/\/$/, "") === SW_SCOPE);
        if (!ours.length) return;
        await Promise.all(ours.map((r) => r.unregister()));
        if (typeof caches !== "undefined") for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX)) await caches.delete(name);
      }).catch(() => undefined);
    }
  } catch { /* never in the way of the page */ }
}
