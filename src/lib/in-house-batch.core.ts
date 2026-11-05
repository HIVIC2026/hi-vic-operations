import { isInHousePartner } from "./in-house.core";
import { contactConsentRecord, phoneConsentCurrent } from "./contact-consent-record.core";
import { displayName } from "./display-name.core";
import { installerEmailWords, type GiveEmailOutcome } from "./in-house-give-email.core";
import { isTestPartner } from "./test-send.core";
import { qaOfficeReservedEmail } from "./qa-office.core";

export type BatchJob = {
  id: string; stage: string; source: string; deleted_at: string | null; spot_saved_at: string | null;
  optedOut: boolean; hasActiveInstaller: boolean; postcode: string | null; lat: number | null; lng: number | null;
  job_number?: string; address?: string; ownerName?: string | null; ownerPhone?: string | null;
  channel?: string; quickTapsYes: boolean; quickTapsBatchId?: string | null; oldStylePass?: boolean; waitingBusinessId?: string | null;
};
export type InHousePartner = {
  id: string; name: string; in_house: boolean; is_active: boolean; openJobs: number;
  service_postcodes: string[]; covers_all_victoria: boolean;
  coverage_lat: number | null; coverage_lng: number | null; coverage_radius_km: number | null;
};
/** Second line on a row when the owner tapped "Yes, let's go". */
export function saidYesLabel(job: Pick<BatchJob, "ownerName" | "quickTapsYes" | "channel">): string | null {
  return job.quickTapsYes === true ? `${displayName(job.ownerName) || "Owner"} said yes · free Ready Check` : null;
}
/** Job page: the owner said yes and the nominated installer is an active in-house partner covering the home. */
export function jobGiveOffer(job: BatchJob | undefined, partners: InHousePartner[]): { businessId: string; partnerName: string; label: string } | null {
  const said = job ? saidYesLabel(job) : null;
  if (!job || !said || !job.waitingBusinessId) return null;
  const partner = partners.find(p => p.id === job.waitingBusinessId && isInHousePartner(p) && p.is_active);
  if (!partner || !batchPartnerCovers(job, partner)) return null;
  return { businessId: partner.id, partnerName: partner.name, label: `${said}. Give to ${partner.name}` };
}
/** `test` (TEST office only, Jo 5 Nov 2026): the same rules for qa_test jobs ONLY; the real office never sees qa_test jobs. */
export function batchJobEligible(job: BatchJob, test = false): boolean {
  return !job.deleted_at && (test ? job.source === "qa_test" : job.source !== "qa_test") && (job.channel === "installer_sourced" || (!!job.spot_saved_at && job.quickTapsYes === true)) && !job.optedOut && !job.hasActiveInstaller
    && ["preliminary_estimate_ready", "ready_check_ready_to_schedule"].includes(job.stage);
}
export const WAITING_FOR_CALL_CONSENT = "Waiting for the owner to say the installer can call";
export type ConsentRow = { consent_status: string; consented_at: string | null; snapshot: unknown; source: string; consent_key?: string | null };
/** Task 5 (Jo 2 Nov 2026): a Home Insulation Victoria lead is handed to its installer only once the owner has said yes in
 *  quick taps AND their phone consent is current (given in the last 3 months, or the batch's own pass-tap consent of any age). Installer's own customers consent at Add a job and are never re-asked. True = otherwise ready to hand
 *  off, but still waiting for that tap. A pass recorded before this change (no go label, `oldStylePass`) is grandfathered:
 *  it is never waiting and hands off as before. */
export function waitingForCallConsent(job: BatchJob, consents: readonly ConsentRow[], nowIso: string, test = false): boolean {
  if (job.oldStylePass || job.channel === "installer_sourced" || !batchJobEligible({ ...job, quickTapsYes: true }, test)) return false;
  // The batch's own pass-tap consent (key quick_taps_reconsent:{batch}:{job}) counts whatever its age: the owner said yes to this installer in this batch.
  const ownKey = job.quickTapsBatchId ? `quick_taps_reconsent:${job.quickTapsBatchId}:${job.id}` : null;
  if (job.quickTapsYes && ownKey && consents.some((r) => r.consent_key === ownKey && r.consent_status === "granted")) return false;
  const latest = contactConsentRecord(consents.filter((r) => r.consent_status === "granted"), []);
  return !job.quickTapsYes || !phoneConsentCurrent(latest?.consentedAt ?? null, nowIso);
}
/** No age fallback: hand off the distinct ticked jobs, any number (Jo 2 Nov 2026). */
export function readyInHouseBatch(jobIds: string[]): string[] {
  // Jo 2 Nov 2026: give any number of ticked jobs (was exactly 5).
  return [...new Set(jobIds)];
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
export function suggestBatches(jobs: BatchJob[], partners: InHousePartner[], test = false): { businessId: string; jobIds: string[] }[] {
  const load = new Map(partners.map(p => [p.id, p.openJobs]));
  const batches = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.id) || !batchJobEligible(job, test)) continue;
    seen.add(job.id);
    const partner = partners.filter(p => isInHousePartner(p) && p.is_active && batchPartnerCovers(job, p) && (!job.waitingBusinessId || p.id === job.waitingBusinessId))
      .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0];
    if (!partner) continue;
    const ids = batches.get(partner.id) ?? [];
    ids.push(job.id); batches.set(partner.id, ids); load.set(partner.id, (load.get(partner.id) ?? 0) + 1);
  }
  return [...batches].map(([businessId, jobIds]) => ({ businessId, jobIds }));
}

/** TEST office Give (Jo 5 Nov 2026): the only refusal wording. */
export const TEST_GIVE_REFUSED = "The TEST office can only give TEST jobs to TEST installers.";
/** A TEST partner for the TEST office: the [TEST PARTNER] mark AND a reserved TEST email (the test-send/TEST-office checks). */
export const isTestGiveBusiness = (b: { email?: string | null; onboarding_notes?: string | null } | null | undefined): boolean =>
  !!b && isTestPartner(b) && qaOfficeReservedEmail(b.email ?? null);
/** TEST office Give: allowed only when EVERY requested job is a live qa_test job AND the business is a TEST partner. */
export function testGiveBlocker(requested: readonly string[], jobs: readonly { id: string; source: string | null; deleted_at: string | null }[], business: { email?: string | null; onboarding_notes?: string | null } | null): string | null {
  if (!requested.length || !isTestGiveBusiness(business)) return TEST_GIVE_REFUSED;
  return requested.every(id => jobs.some(j => j.id === id && j.source === "qa_test" && !j.deleted_at)) ? null : TEST_GIVE_REFUSED;
}

/** Jo 2 Nov 2026: say how many went and which weren't given (job number + reason). */
export function giveNotice(result: { sent: string[]; refused: { jobId: string; reason: string }[]; installerEmail?: GiveEmailOutcome }, partner: string, jobNumber: (id: string) => string): string {
  const n = result.sent.length;
  const given = n ? `${n} ${n === 1 ? "job" : "jobs"} given to ${partner}.` : "";
  const emailed = n && result.installerEmail ? installerEmailWords(result.installerEmail, partner) : "";
  const notGiven = result.refused.length ? `Not given: ${result.refused.map(r => `${jobNumber(r.jobId)} (${r.reason})`).join("; ")}.` : "";
  return [given, emailed, notGiven].filter(Boolean).join(" ");
}
