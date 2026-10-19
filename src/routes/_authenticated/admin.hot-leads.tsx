import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired standalone bulk-email page. Bulk sending is now the existing automatic sender in Communications › Outgoing.
// The old component and sender are untouched in source; this page no longer exposes a competing send interface.
export const Route = createFileRoute("/_authenticated/admin/hot-leads")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/communications", search: { tab: "outgoing" }, replace: true });
  },
  component: () => null,
});
