import { createFileRoute, redirect } from "@tanstack/react-router";

// Owner paperwork merged into Settings › Templates (one wording register); the owner-signs-again switch is removed (decision 119).
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/owner-paperwork")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/settings", search: { tab: "templates" }, replace: true });
  },
  component: () => null,
});
