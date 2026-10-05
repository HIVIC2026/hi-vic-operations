import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, userIdOf } from "@/lib/route-guards";

// Trade work area (installers, electricians and their workers).
export const Route = createFileRoute("/_authenticated/field")({
  beforeLoad: async ({ context }) => {
    const a = await loadAccess(userIdOf(context));
    if (!(a.admin || a.installer || a.electrician)) throw redirect({ to: "/home" });
  },
  component: () => <Outlet />,
});
