import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, userIdOf } from "@/lib/route-guards";

// Office-only area: every /admin page needs the admin role. Server functions still check on their own.
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    if (!(await loadAccess(userIdOf(context))).admin) throw redirect({ to: "/home" });
  },
  component: () => <Outlet />,
});
