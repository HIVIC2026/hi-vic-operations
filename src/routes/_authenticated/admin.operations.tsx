import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy operations overview. Its categories map onto the three primary workspaces.
export const Route = createFileRoute("/_authenticated/admin/operations")({
  beforeLoad: ({ search }) => {
    const category = (search as { category?: string }).category;
    if (category === "active") throw redirect({ to: "/admin/jobs/active", replace: true });
    if (category === "closed") throw redirect({ to: "/admin/jobs/closed", replace: true });
    throw redirect({ to: "/admin/enquiries", replace: true });
  },
  component: () => null,
});
