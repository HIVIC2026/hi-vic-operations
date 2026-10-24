import { createFileRoute, redirect } from "@tanstack/react-router";

// Approved partners now live under Partners › Approved (office audit, decision 232); each business opens its business file.
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/businesses")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/partners", search: { tab: "approved" }, replace: true });
  },
  component: () => null,
});
