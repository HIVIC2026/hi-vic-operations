import { createFileRoute, redirect } from "@tanstack/react-router";

// REMOVED (office audit): the Partners overview cards (live jobs, on-time %, reply time) measured nothing Jo decided on.
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/partners-overview")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/partners", search: {}, replace: true });
  },
  component: () => null,
});
