import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, userIdOf } from "@/lib/route-guards";
import { qaOfficeRouteAllowed, TEST_OFFICE_UNAVAILABLE } from "@/lib/qa-office-policy.core";

// Office-only area: every /admin page needs the admin role. Server functions still check on their own.
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context, location }) => {
    const access = await loadAccess(userIdOf(context));
    if (access.admin) return;
    if (access.qaOffice) {
      if (!qaOfficeRouteAllowed(location.pathname, location.searchStr)) throw new Error(TEST_OFFICE_UNAVAILABLE);
      return;
    }
    throw redirect({ to: "/home" });
  },
  errorComponent: ({ error }) => <p role="alert">{error.message}</p>,
  component: () => <Outlet />,
});
