import { createFileRoute, redirect } from "@tanstack/react-router";

// The office home is Needs me (decision 218). Old ?tab= bookmarks still land somewhere sensible: the retired Quote
// approvals board → Jobs › Quote, the old jobs tab → Jobs, ineligible → Jobs › Closed.
export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: ({ search }) => {
    const tab = (search as { tab?: string }).tab;
    if (tab === "quotes") throw redirect({ to: "/admin/jobs/active", search: { stage: "quote" }, replace: true });
    if (tab === "jobs") throw redirect({ to: "/admin/jobs/active", replace: true });
    if (tab === "ineligible") throw redirect({ to: "/admin/jobs/closed", replace: true });
    if (tab === "enquiries") throw redirect({ to: "/admin/enquiries", replace: true });
    throw redirect({ to: "/admin/needs-me", replace: true });
  },
  component: () => null,
});
