import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadAccess, userIdOf } from "@/lib/route-guards";

// Trade work area (installers, electricians, approved FFS partners and their workers).
// FFS = an approved partner business member (businessAdmin) with no installer/electrician role.
// portalDestination() already routes { roles: [], hasBusiness: true } here; this guard must admit
// them too. No new DB permissions are granted — job/quote visibility stays governed by the
// existing can_access_job RLS, so a partner with no assignments simply sees an empty "My work".
export const Route = createFileRoute("/_authenticated/field")({
  beforeLoad: async ({ context }) => {
    const a = await loadAccess(userIdOf(context));
    if (!(a.admin || a.installer || a.electrician || a.businessAdmin)) throw redirect({ to: "/home" });
  },
  component: () => <Outlet />,
});
