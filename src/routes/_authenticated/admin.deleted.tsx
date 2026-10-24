import { createFileRoute, redirect } from "@tanstack/react-router";

// Deleted jobs are Settings › Deleted (decision 248).
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/deleted")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/settings", search: { tab: "deleted" }, replace: true });
  },
  component: () => null,
});
