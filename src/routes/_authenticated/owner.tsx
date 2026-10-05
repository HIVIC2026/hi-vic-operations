import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, userIdOf } from "@/lib/route-guards";

// Owner area (signed-in owners; office can look in).
export const Route = createFileRoute("/_authenticated/owner")({
  beforeLoad: async ({ context }) => {
    const a = await loadAccess(userIdOf(context));
    if (!(a.admin || a.owner)) throw redirect({ to: "/home" });
  },
  component: () => <Outlet />,
});
