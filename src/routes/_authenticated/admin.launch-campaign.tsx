import { createFileRoute, redirect } from "@tanstack/react-router";

// Campaigns tab removed (office audit, decision 180); saved spots are on Enquiries/Jobs. Old bookmark → Communications.
export const Route = createFileRoute("/_authenticated/admin/launch-campaign")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/communications", search: {}, replace: true });
  },
  component: () => null,
});
