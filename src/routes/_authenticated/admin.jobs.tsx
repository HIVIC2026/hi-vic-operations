import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// `/admin/jobs` is not a workspace of its own: active jobs are the one list. Job detail pages
// (`/admin/jobs/$jobId`) and the active/closed routes render normally through this shell.
export const Route = createFileRoute("/_authenticated/admin/jobs")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/+$/, "") === "/admin/jobs") {
      throw redirect({ to: "/admin/jobs/active", replace: true });
    }
  },
  component: () => <Outlet />,
});
