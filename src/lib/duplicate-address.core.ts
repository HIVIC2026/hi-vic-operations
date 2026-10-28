// Decision 282 (Jo 25 Oct 2026): "it's only the address that matters". One email or phone may sit on any number of
// owners and jobs; nothing refuses on email/phone. A job already OPEN (not cancelled/complete, not deleted) at the
// same normalised address links the new request to that job with an office flag — no second job. Pure rules only;
// the lookups live in duplicate-address.server.ts.
import { addressKey, type AddressKeyInput } from "./address.core";

export const DUPLICATE_ADDRESS_EVENT = "duplicate_address_linked";
export const CLOSED_JOB_STAGES = new Set(["cancelled", "complete"]);
export const isOpenJobStage = (stage: string | null | undefined) => !!stage && !CLOSED_JOB_STAGES.has(stage);

export type AddressJobCandidate = { id: string; job_number: string | null; stage: string | null; source: string | null; deleted_at?: string | null; created_at?: string | null } & AddressKeyInput;

/** Practice (qa_test) requests only ever match practice jobs, and real requests never match practice jobs. */
export const practiceMatches = (requestSource: string | null | undefined, jobSource: string | null | undefined) =>
  (requestSource === "qa_test") === (jobSource === "qa_test");

/** The open job at this address; when several exist the oldest wins (that is the one already in progress). */
export function openJobAtAddress<T extends AddressJobCandidate>(request: AddressKeyInput & { source?: string | null }, jobs: T[]): T | null {
  const key = addressKey(request);
  if (!key) return null;
  const hits = jobs.filter((j) => !j.deleted_at && isOpenJobStage(j.stage) && practiceMatches(request.source, j.source) && addressKey(j) === key);
  return hits.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0] ?? null;
}

/** What the installer is told: the job number only, never the other customer's details. */
export const duplicateAddressMessage = (jobNumber: string | null) =>
  `This address already has an open job (${jobNumber ?? "job number pending"}) — the office has been told. No new job was added; your details are kept.`;

export type DuplicateAddressFrom = "add_a_job" | "upload_jobs" | "website" | "installer_intake" | "office_intake" | "email" | "mitti_pickup";
const FROM_WORDS: Record<DuplicateAddressFrom, string> = {
  add_a_job: "an installer's Add a job", upload_jobs: "an installer's Upload jobs", website: "the website", installer_intake: "an installer's Add one job",
  office_intake: "office intake", email: "an email enquiry", mitti_pickup: "a Ready Check started in Mitti",
};
/** Which path a source string came through (for the flag wording only). */
export function duplicateAddressFrom(source: string, channel: "installer_sourced" | "hivic_sourced" | string): DuplicateAddressFrom {
  if (channel === "installer_sourced") return "installer_intake";
  if (source === "base44") return "website";
  if (source === "email") return "email";
  return "office_intake";
}
/** Office flag wording on the existing job: says where the request came from, names nobody. */
export function duplicateAddressSummary(from: DuplicateAddressFrom, businessName: string | null): string {
  return `Another request for this address came in from ${FROM_WORDS[from]}${businessName ? ` (${businessName})` : ""} — linked here, no new job made; office to check`;
}

/** Jo 28 Oct: an installer's Add a job at an open HIV lead is saved and flagged; another installer's open job is still refused. */
export const addJobClashAction = (open: { channel: string | null } | null): "none" | "save_and_flag" | "refuse" =>
  !open ? "none" : open.channel === "hivic_sourced" ? "save_and_flag" : "refuse";

/** Office flag wording on the NEW installer job when its address is already an HIV lead. */
export const hivLeadClashSummary = (existingJobNumber: string) =>
  `This address is already a Home Insulation Victoria lead (${existingJobNumber}) — the installer's job was saved; office to check`;
