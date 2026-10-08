import type { OperationBucket, OperationRow, Party } from "./operations-preview.core";

export type OperationsFilter = {
  category?: string; process?: string | null; party?: string | null;
  source?: string; eligibility?: string; flag?: string | null; q?: string; page?: number;
};
export function categoryBucket(category?: string): OperationBucket | "All" {
  return category === "leads" ? "Leads" : category === "active" ? "Active jobs" : category === "closed" ? "Closed jobs" : category === "needs" ? "Needs classification" : "All";
}
export function bucketCategory(bucket: OperationBucket | "All") {
  return bucket === "Leads" ? "leads" : bucket === "Active jobs" ? "active" : bucket === "Closed jobs" ? "closed" : bucket === "Needs classification" ? "needs" : "overview";
}
export function filterOperations(rows: OperationRow[], f: OperationsFilter) {
  const bucket = categoryBucket(f.category);
  return rows.filter(r => (bucket === "All" || r.bucket === bucket)
    && (!f.process || r.process === f.process)
    && (!f.party || r.tasks.some(t => t.party === f.party as Party))
    && (!f.source || f.source === "all" || r.channel === f.source)
    && (!f.eligibility || f.eligibility === "all" || r.eligibilityGroup === f.eligibility)
    && (!f.flag || (f.flag === "spot" ? r.spotSavedOpen : f.flag === "media" ? r.mediaToReview : false))
    && `${r.jobNumber} ${r.owner} ${r.address} ${r.originatingInstaller} ${r.assignedInstaller}`.toLowerCase().includes((f.q ?? "").toLowerCase()));
}