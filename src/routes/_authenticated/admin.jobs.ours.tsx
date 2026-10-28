import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsLaneScreen } from "@/components/portal/JobsLaneScreen";
import { JOBS_STAGE_KEYS, type JobsStage } from "@/lib/office-jobs.core";

// O3 Jobs › Our jobs. `?stage=` opens one stage (old Quote approvals links land on Quote).
export const Route = createFileRoute("/_authenticated/admin/jobs/ours")({
  validateSearch: (s: Record<string, unknown>): { stage?: JobsStage } => (typeof s["stage"] === "string" && (JOBS_STAGE_KEYS as string[]).includes(s["stage"]) ? { stage: s["stage"] as JobsStage } : {}),
  head: () => ({ meta: [
    { title: "Our jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Jobs we run ourselves, with the next step for each." },
    { property: "og:title", content: "Our jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "Our jobs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: OurJobsPage,
});

function OurJobsPage() {
  const { stage } = Route.useSearch();
  return <AppShell><JobsLaneScreen lane="ours" initialStage={stage} /></AppShell>;
}
