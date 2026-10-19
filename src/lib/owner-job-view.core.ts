// STEP 80 (W4): the Homeowner job page must always reach a terminal state. getJobOverview refuses a job the caller may
// not see with the same message whether it belongs to another customer or does not exist (my_job_role is null for
// both), and useJob does not retry that refusal. The page previously ignored the error and showed "Loading…" forever.
// Pure, so the rule is unit-testable; the message is neutral and never says whether the job exists.
export const OWNER_JOB_UNAVAILABLE = "This job is unavailable or you do not have permission to access it.";

export type OwnerJobView = "ready" | "loading" | "unavailable";

/** A loaded job always wins (a failed background refetch keeps showing it); otherwise a failed load is terminal. */
export function ownerJobView(q: { hasJob: boolean; isError: boolean }): OwnerJobView {
  if (q.hasJob) return "ready";
  return q.isError ? "unavailable" : "loading";
}
