import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { JobsScreen } from "@/components/portal/JobsScreen";
import { JOBS_STAGE_KEYS, type JobsStage } from "@/lib/office-jobs.core";

// O3 Jobs › Active (decisions 224, 226, 239). `?stage=` opens one of the six stages (old Quote approvals links land on Quote).
export const Route = createFileRoute("/_authenticated/admin/jobs/active")({
  validateSearch: (s: Record<string, unknown>): { stage?: JobsStage } => (typeof s["stage"] === "string" && (JOBS_STAGE_KEYS as string[]).includes(s["stage"]) ? { stage: s["stage"] as JobsStage } : {}),
  head: () => ({ meta: [
    { title: "Jobs — Home Insulation Victoria Office" },
    { name: "description", content: "Every job from Choose installer to Final check, one stage each." },
    { property: "og:title", content: "Jobs — Home Insulation Victoria Office" },
    { property: "og:description", content: "Active jobs in six stages." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => {
    const { stage } = Route.useSearch();
    return <AppShell><JobsScreen mode="active" initialStage={stage} /></AppShell>;
  },
});
