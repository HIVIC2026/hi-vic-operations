import { createFileRoute, redirect } from "@tanstack/react-router";

// Staff approvals are Partners › People (decision 153: CII level + expiry recorded by the office).
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/workers")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/partners", search: { tab: "people" }, replace: true });
  },
  component: () => null,
});
