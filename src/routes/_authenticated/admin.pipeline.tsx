import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy stage counter. Its only destination was /admin/list, now the Active jobs workspace.
export const Route = createFileRoute("/_authenticated/admin/pipeline")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/jobs/active", replace: true });
  },
  component: () => null,
});
