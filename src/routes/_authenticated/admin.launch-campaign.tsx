import { createFileRoute, redirect } from "@tanstack/react-router";

// Saved-spot campaign review now lives inside Communications › Campaigns.
export const Route = createFileRoute("/_authenticated/admin/launch-campaign")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/communications", search: { tab: "campaigns" }, replace: true });
  },
  component: () => null,
});
