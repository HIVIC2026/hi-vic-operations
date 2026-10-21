import { createFileRoute, redirect } from "@tanstack/react-router";

// Historical read-only preview of the operations aggregate. Superseded by the consolidated workspaces.
export const Route = createFileRoute("/_authenticated/admin/operations-preview")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/jobs/active", replace: true });
  },
  component: () => null,
});
