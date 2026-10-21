import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired 21 Oct (Jo): the old status list. Old links land on Active jobs.
export const Route = createFileRoute("/_authenticated/admin/list")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/jobs/active", replace: true });
  },
  component: () => null,
});
