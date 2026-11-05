// Single-job saves invalidate every cached query, but defer expensive office-list reads until navigation.
// Unclassified active panels retain the existing refresh, including all payment and compliance panels.
const OFFICE_LISTS = new Set(["office-jobs", "office-enquiries", "office-closed-jobs", "installer-waiting", "jobs-lane-counts"]);

export function actionJobId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("jobId" in data)) return undefined;
  return typeof data.jobId === "string" && data.jobId.length > 0 ? data.jobId : undefined;
}

export function refreshAfterJobAction(key: readonly unknown[], jobId: string | undefined): boolean {
  if (!jobId) return true;
  if (typeof key[0] === "string" && OFFICE_LISTS.has(key[0])) return false;
  // UUID-keyed job queries use the job id as their second key; synthetic ids also work in tests.
  if (typeof key[1] === "string" && (key[0] === "office-job-page" || key[0] === "office-job" || key[0] === "office-job-money" || key[0] === "trade-job-bundle")) return key[1] === jobId;
  return true;
}