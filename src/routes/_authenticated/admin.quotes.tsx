import { createFileRoute, redirect } from "@tanstack/react-router";

// The retired Quote approvals queue (decision 7 / audit removal 1). Old links land on Jobs › Quote.
export const Route = createFileRoute("/_authenticated/admin/quotes")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/jobs/active", search: { stage: "quote" }, replace: true });
  },
  component: () => null,
});
