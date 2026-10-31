import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, userIdOf } from "@/lib/route-guards";
import { startTradeScreenForPath } from "@/lib/trade-route-prefetch";

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
  component: () => <Outlet />,
});
