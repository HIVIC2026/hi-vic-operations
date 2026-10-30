import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsLaneScreen } from "@/components/portal/JobsLaneScreen";

// O3 Jobs › Installer jobs: jobs an installer brought to us.
export const Route = createFileRoute("/_authenticated/admin/jobs/installers")({
  head: () => ({ meta: [
    { title: "Installer jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Jobs brought to us by installers, with the next step for each." },
    { property: "og:title", content: "Installer jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "Installer jobs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <AppShell><JobsLaneScreen lane="installer" /></AppShell>,
});
