import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { loadAccess, userIdOf } from "@/lib/route-guards";
import { startTradeScreenForPath } from "@/lib/trade-route-prefetch";
import { registerInstallerAppCache } from "@/lib/installer-app-cache";

// Trade work area (installers, electricians and their workers).
export const Route = createFileRoute("/_authenticated/field")({
  beforeLoad: async ({ context, location, preload }) => {
    const uid = userIdOf(context);
    // Speed: the screen's own server call starts now, alongside the role reads, not after them. The role check below
    // still decides whether any trade screen draws; the server checks access on that call itself.
    startTradeScreenForPath(context, location.pathname, preload);
    const a = await loadAccess(uid);
    if (!(a.admin || a.installer || a.electrician)) throw redirect({ to: "/home" });
  },
  component: FieldArea,
});

// Installer app cache (Jo, 3 Nov 2026): the service worker that keeps the app shell on the phone registers here, on the
// trade routes only, and only while the switch in installer-app-cache.core is on (off today).
function FieldArea() {
  useEffect(() => { registerInstallerAppCache(); }, []);
  return <Outlet />;
}
