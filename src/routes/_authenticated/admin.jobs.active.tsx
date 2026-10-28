import { createFileRoute, redirect } from "@tanstack/react-router";
import { JOBS_STAGE_KEYS, type JobsStage } from "@/lib/office-jobs.core";

// Old bookmark: Jobs › Active is now Our jobs. Keeps `?stage=` so old Quote approvals links still land on Quote.
export const Route = createFileRoute("/_authenticated/admin/jobs/active")({
  validateSearch: (s: Record<string, unknown>): { stage?: JobsStage } => (typeof s["stage"] === "string" && (JOBS_STAGE_KEYS as string[]).includes(s["stage"]) ? { stage: s["stage"] as JobsStage } : {}),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/admin/jobs/ours", search: search.stage ? { stage: search.stage } : {}, replace: true });
  },
});
