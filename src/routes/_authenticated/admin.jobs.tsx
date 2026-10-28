import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// `/admin/jobs` is not a workspace of its own: Our jobs is the default. Job detail pages
// (`/admin/jobs/$jobId`) and the ours/installers/closed routes render normally through this shell.
export const Route = createFileRoute("/_authenticated/admin/jobs")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/+$/, "") === "/admin/jobs") {
      throw redirect({ to: "/admin/jobs/ours", replace: true });
    }
  },
  component: () => <Outlet />,
});
