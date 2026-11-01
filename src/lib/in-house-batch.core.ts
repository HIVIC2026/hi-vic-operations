import { isInHousePartner } from "./in-house.core";

export type BatchJob = {
  id: string; stage: string; source: string; deleted_at: string | null; spot_saved_at: string | null;
  optedOut: boolean; hasActiveInstaller: boolean; postcode: string | null; lat: number | null; lng: number | null;
  job_number?: string; address?: string;
  channel?: string; quickTapsYes: boolean; waitingBusinessId?: string | null;
};
export type InHousePartner = {
  id: string; name: string; in_house: boolean; is_active: boolean; openJobs: number;
  service_postcodes: string[]; covers_all_victoria: boolean;
  coverage_lat: number | null; coverage_lng: number | null; coverage_radius_km: number | null;
};
export function batchJobEligible(job: BatchJob): boolean {
  return !job.deleted_at && job.source !== "qa_test" && (job.channel === "installer_sourced" || (!!job.spot_saved_at && job.quickTapsYes === true)) && !job.optedOut && !job.hasActiveInstaller
    && ["preliminary_estimate_ready", "ready_check_ready_to_schedule"].includes(job.stage);
}
/** No age fallback: hand off exactly five distinct waiting jobs. */
export function readyInHouseBatch(jobIds: string[]): string[] {
  const ids = [...new Set(jobIds)];
  return ids.length >= 5 ? ids.slice(0, 5) : [];
}
export function batchPartnerCovers(job: BatchJob, partner: InHousePartner): boolean {
  if (partner.covers_all_victoria || (job.postcode && partner.service_postcodes.includes(job.postcode))) return true;
  const { lat, lng } = job;
  const { coverage_lat: originLat, coverage_lng: originLng, coverage_radius_km: radius } = partner;
  if (lat == null || lng == null || originLat == null || originLng == null || radius == null || radius < 0) return false;
  if (![lat, lng, originLat, originLng, radius].every(Number.isFinite)) return false;
  const radians = (n: number) => n * Math.PI / 180;
  const a = Math.sin(radians(lat - originLat) / 2) ** 2 + Math.cos(radians(lat)) * Math.cos(radians(originLat)) * Math.sin(radians(lng - originLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) <= radius;
}
export function suggestBatches(jobs: BatchJob[], partners: InHousePartner[]): { businessId: string; jobIds: string[] }[] {
  const load = new Map(partners.map(p => [p.id, p.openJobs]));
  const batches = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.id) || !batchJobEligible(job)) continue;
    seen.add(job.id);
    const partner = partners.filter(p => isInHousePartner(p) && p.is_active && batchPartnerCovers(job, p) && (!job.waitingBusinessId || p.id === job.waitingBusinessId))
      .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0];
    if (!partner) continue;
    const ids = batches.get(partner.id) ?? [];
    ids.push(job.id); batches.set(partner.id, ids); load.set(partner.id, (load.get(partner.id) ?? 0) + 1);
  }
  return [...batches].map(([businessId, jobIds]) => ({ businessId, jobIds }));
}