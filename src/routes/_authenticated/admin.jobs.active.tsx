import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsWorkspace } from "@/components/portal/JobsWorkspace";

export const Route = createFileRoute("/_authenticated/admin/jobs/active")({
  head: () => ({ meta: [
    { title: "Active jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Every operational job with its current stage, next action and who it is waiting on." },
    { property: "og:title", content: "Active jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "One active jobs workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <AppShell wide><JobsWorkspace mode="active" /></AppShell>,
});
