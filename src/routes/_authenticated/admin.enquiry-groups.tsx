import { createFileRoute, redirect } from "@tanstack/react-router";

const ALLOWED = [
  "all",
  "new",
  "spot_saved",
  "offered_spot",
  "insulation_requested",
  "ineligible",
  "needs_attention",
  "photos",
  "removed",
] as const;
type Allowed = (typeof ALLOWED)[number];

// Legacy "Leads" page. There is now ONE enquiry workspace; bookmarks land on it.
export const Route = createFileRoute("/_authenticated/admin/enquiry-groups")({
  beforeLoad: ({ search }) => {
    const raw = (search as { status?: string }).status ?? "";
    const status: Allowed = (ALLOWED as readonly string[]).includes(raw) ? (raw as Allowed) : "all";
    throw redirect({ to: "/admin/enquiries", search: { status }, replace: true });
  },
  component: () => null,
});
