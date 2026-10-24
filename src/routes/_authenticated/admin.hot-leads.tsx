import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired standalone bulk-email page. Bulk sending is the existing automatic sender; Communications › Held & queued shows what is waiting.
// The old component and sender are untouched in source; this page no longer exposes a competing send interface.
export const Route = createFileRoute("/_authenticated/admin/hot-leads")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/communications", search: {}, replace: true });
  },
  component: () => null,
});
