import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { EnquiriesScreen } from "@/components/portal/EnquiriesScreen";

// O4 Enquiries (decisions 238/281/285: one list, one search box). Old ?status= bookmarks keep working: a saved spot is
// now a job (Jobs › Choose installer) and ineligible / removed enquiries live on Jobs › Closed.
export const Route = createFileRoute("/_authenticated/admin/enquiries")({
  beforeLoad: ({ search }) => {
    const status = (search as { status?: string }).status;
    if (status === "spot_saved") throw redirect({ to: "/admin/jobs/ours", search: { stage: "choose_installer" }, replace: true });
    if (status === "ineligible" || status === "removed") throw redirect({ to: "/admin/jobs/closed", replace: true });
  },
  validateSearch: (s: Record<string, unknown>): { status?: string } => (typeof s["status"] === "string" ? { status: s["status"] } : {}),
  head: () => ({
    meta: [
      { title: "Enquiries — Home Insulation Victoria Office" },
      { name: "description", content: "Every enquiry before a spot is saved, in one list, waiting on the owner." },
      { property: "og:title", content: "Enquiries — Home Insulation Victoria Office" },
      { property: "og:description", content: "One list: every enquiry waiting on the owner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <AppShell><EnquiriesScreen /></AppShell>,
});
