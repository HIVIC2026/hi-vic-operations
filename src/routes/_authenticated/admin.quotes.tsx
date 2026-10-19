import { createFileRoute, redirect } from "@tanstack/react-router";

// Quote approvals live in the one existing queue, reached from More. No separate blank page.
export const Route = createFileRoute("/_authenticated/admin/quotes")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/board", search: { tab: "quotes" }, replace: true });
  },
  component: () => null,
});
