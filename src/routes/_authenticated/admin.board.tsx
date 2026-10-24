import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired 24 Oct 2026 (decision 218, audit removal 1): the Pipeline board and its Quote approvals tab. Quotes are
// prepared on Mitti Complete and sent from the job's Quote card (Needs me › Quotes to check); the board no longer
// runs sweepAuthorities / autoAdvancePipeline on open. New enquiry (phone) moved to Enquiries; bulk actions to the
// Jobs and Enquiries Actions menus. Old links land on Jobs (the quotes tab on Jobs › Quote).
export const Route = createFileRoute("/_authenticated/admin/board")({
  beforeLoad: ({ search }) => {
    if ((search as { tab?: string }).tab === "quotes") throw redirect({ to: "/admin/jobs/active", search: { stage: "quote" }, replace: true });
    throw redirect({ to: "/admin/jobs/active", replace: true });
  },
  component: () => null,
});
