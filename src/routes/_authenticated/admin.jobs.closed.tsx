import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsWorkspace } from "@/components/portal/JobsWorkspace";

export const Route = createFileRoute("/_authenticated/admin/jobs/closed")({
  head: () => ({ meta: [
    { title: "Closed jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Completed, cancelled and ineligible jobs kept separate." },
    { property: "og:title", content: "Closed jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "One closed jobs workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <AppShell wide><JobsWorkspace mode="closed" /></AppShell>,
});
