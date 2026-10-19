import { createFileRoute, redirect } from "@tanstack/react-router";

// The Office landing page is the Enquiries workspace. The old Job Pipeline board is preserved
// as an internal detail view (/admin/board) so bookmarked board links and its bulk tools still work.
export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: ({ search }) => {
    const tab = (search as { tab?: string }).tab;
    if (tab === "quotes")
      throw redirect({ to: "/admin/board", search: { tab: "quotes" }, replace: true });
    if (tab === "jobs") throw redirect({ to: "/admin/jobs/active", replace: true });
    if (tab === "ineligible")
      throw redirect({ to: "/admin/enquiries", search: { status: "ineligible" }, replace: true });
    throw redirect({ to: "/admin/enquiries", replace: true });
  },
  component: () => null,
});
