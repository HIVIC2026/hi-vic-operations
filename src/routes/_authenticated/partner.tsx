import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, partnerPathAllowed, userIdOf } from "@/lib/route-guards";

// Trade business area: trades only; money, profile and staff for the business boss; adding jobs for installer bosses.
export const Route = createFileRoute("/_authenticated/partner")({
  beforeLoad: async ({ context, location }) => {
    if (!partnerPathAllowed(location.pathname, await loadAccess(userIdOf(context)))) throw redirect({ to: "/home" });
  },
  component: () => <Outlet />,
});
