import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsScreen } from "@/components/portal/JobsScreen";

// O3 Jobs › Closed (decision 227: Reopen with a reason): Completed · Cancelled · Ineligible · Removed / test.
export const Route = createFileRoute("/_authenticated/admin/jobs/closed")({
  head: () => ({ meta: [
    { title: "Closed jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Completed, cancelled, ineligible and removed jobs, each in one pile." },
    { property: "og:title", content: "Closed jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "Closed jobs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <AppShell><JobsScreen mode="closed" /></AppShell>,
});
