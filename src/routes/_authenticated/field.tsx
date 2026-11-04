import { lazy, Suspense } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { loadAccess, userIdOf } from "@/lib/route-guards";
import { startTradeScreenForPath } from "@/lib/trade-route-prefetch";
import { registerInstallerAppCache } from "@/lib/installer-app-cache";

// The layout that shows the "you don't need to sign in" page loads on its own, so the guard below stays light.
const FieldLayout = lazy(() => import("@/components/trade/FieldLayout"));

// Trade work area (installers and their business admins). Electricians never log in (new job flow Part 6): each job
// reaches them as one no-login link (/e/<token>). An old electrician-only login that still gets here sees one plain line.
export const Route = createFileRoute("/_authenticated/field")({
  beforeLoad: async ({ context, location, preload }) => {
    const uid = userIdOf(context);
    // Speed: the screen's own server call starts now, alongside the role reads, not after them. The role check below
    // still decides whether any trade screen draws; the server checks access on that call itself.
    startTradeScreenForPath(context, location.pathname, preload);
    const a = await loadAccess(uid);
    if (!(a.admin || a.installer || a.electrician)) throw redirect({ to: "/home" });
  },
  // The layout reads the same access memo: an electrician-only app role (a.electrician && !a.installer && !a.admin)
  // gets the plain NO_LOGIN_NEEDED line (trade-access-role.core), never a blank page.
  component: FieldArea,
});

// Installer app cache (Jo, 3 Nov 2026): the service worker that keeps the app shell on the phone registers here, on the
// trade routes only, and only while the switch in installer-app-cache.core is on (off today).
function FieldArea() {
  useEffect(() => { registerInstallerAppCache(); }, []);
  return <Suspense fallback={<Outlet />}><FieldLayout /></Suspense>;
}
