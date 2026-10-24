import { createFileRoute, redirect } from "@tanstack/react-router";

// Coverage is a Partners tab (decision 229).
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/coverage")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/partners", search: { tab: "coverage" }, replace: true });
  },
  component: () => null,
});
