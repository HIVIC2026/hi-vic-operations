import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { InstallerWaitingScreen } from "@/components/portal/InstallerWaitingScreen";

// Decision 378: Jobs › Choose installer — our-lead jobs with a saved spot waiting for the office to pick an installer.
export const Route = createFileRoute("/_authenticated/admin/jobs/choose-installer")({
  head: () => ({
    meta: [
      { title: "Choose installer — Home Insulation Victoria Office" },
      { name: "description", content: "Saved spots waiting for an installer, in one sortable list." },
      { property: "og:title", content: "Choose installer — Home Insulation Victoria Office" },
      { property: "og:description", content: "Saved spots waiting for an installer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <AppShell><InstallerWaitingScreen /></AppShell>,
});
