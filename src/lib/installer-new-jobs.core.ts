// Jo 23 Oct 2026: the office must see every job an installer brings in (bulk upload, Mitti, portal add, on site)
// and is reminded when a Ready Check hasn't started after 14 days. Pure presentation rules only: never a
// workflow, eligibility or quote decision. "Seen" is an office acknowledgement record; it changes nothing else.

export const NEW_JOB_WINDOW_DAYS = 30;
export const NOT_STARTED_REMINDER_DAYS = 14;
export const OFFICE_SEEN_EVENT = "office_installer_job_seen";

/** Stages before the Ready Check answers come back; a job past these has clearly started. */
export const PRE_READY_CHECK_STAGES = [
  "new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance",
  "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled",
] as const;

/** Events that prove Ready Check answers have reached the portal from Mitti. */
export const FORM_STARTED_EVENTS = ["ready_check_basics", "mitti_measureup_synced", "mitti_synced"] as const;
/** Office-flagged Mitti events that were previously written to the timeline only. */
export const FLAG_EVENTS = ["mitti_pickup_clash", "mitti_pickup_installer_started_a2"] as const;
export const HELD_EVENTS = ["installer_quote_held", "ready_check_needs_office"] as const;
/** Office correction that withdraws an earlier A2 note ("recorded in error"). */
export const A2_CORRECTION_EVENT = "mitti_pickup_note_correction";

export type NewJobFacts = {
  jobId: string; jobNumber: string; createdAt: string; source: string | null; stage: string;
  owner: string | null; address: string | null; installer: string | null;
  eligibility: string | null; hasMittiForm: boolean; mittiAuditId: string | null; hasQuote: boolean;
  /** Event types and summaries for this job, newest first. */
  events: { type: string; at: string; summary: string | null; details: Record<string, unknown> | null }[];
};

export type NewJobItem = {
  jobId: string; jobNumber: string; owner: string | null; address: string | null; installer: string | null;
  how: string; createdAt: string; ageDays: number; mittiAuditId: string | null;
  isNew: boolean; notStarted: boolean; warnings: string[];
};

const HOW: Record<string, string> = {
  bulk_import: "Bulk upload", installer_mitti: "Started in Mitti", installer_import: "Added in portal",
  installer_onsite: "Added on site", qa_test: "Practice job",
};
export const howAdded = (source: string | null) => HOW[source ?? ""] ?? "Added by installer";

export const ageInDays = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));

/** What the office should know about one installer job, or null when it needs no mention. */
export function classifyNewInstallerJob(f: NewJobFacts, now: Date): NewJobItem | null {
  const ageDays = ageInDays(f.createdAt, now);
  const types = new Set(f.events.map((e) => e.type));
  const isNew = ageDays <= NEW_JOB_WINDOW_DAYS && !types.has(OFFICE_SEEN_EVENT);
  const started = f.hasQuote || FORM_STARTED_EVENTS.some((t) => types.has(t)) || !(PRE_READY_CHECK_STAGES as readonly string[]).includes(f.stage);
  const notStarted = !started && ageDays >= NOT_STARTED_REMINDER_DAYS;
  if (!isNew && !notStarted) return null;

  const warnings: string[] = [];
  const correction = f.events.find((x) => x.type === A2_CORRECTION_EVENT);
  for (const t of FLAG_EVENTS) {
    const e = f.events.find((x) => x.type === t);
    if (e && t === "mitti_pickup_installer_started_a2" && correction && correction.at > e.at) continue;
    if (e) warnings.push(e.summary?.trim() || (t === "mitti_pickup_clash" ? "Possible duplicate of another job" : "Installer started a Home Insulation Victoria form"));
  }
  if (f.eligibility === "does_not_appear_eligible") warnings.push("Eligibility check: does not appear eligible");
  if (!f.hasMittiForm) warnings.push("No Mitti Ready Check form yet");
  const basics = f.events.find((e) => e.type === "ready_check_basics");
  const missing = (basics?.details?.["missing"] as string[] | undefined) ?? [];
  if (basics && missing.length) warnings.push(`Ready Check missing: ${missing.join(", ")}`);
  const held = f.events.find((e) => (HELD_EVENTS as readonly string[]).includes(e.type));
  if (held) {
    const d = held.details ?? {};
    const reasons = (d["blockers"] as string[] | undefined) ?? (d["reasons"] as string[] | undefined) ?? [];
    warnings.push(`Quote held${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
  }
  if (notStarted) warnings.push(`Ready Check not started after ${ageDays} days`);

  return {
    jobId: f.jobId, jobNumber: f.jobNumber, owner: f.owner, address: f.address, installer: f.installer,
    how: howAdded(f.source), createdAt: f.createdAt, ageDays, mittiAuditId: f.mittiAuditId, isNew, notStarted, warnings,
  };
}

/** New first (newest on top), then the 14-day reminders (oldest on top). */
export function sortNewInstallerJobs(items: NewJobItem[]) {
  return {
    fresh: items.filter((i) => i.isNew).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    stale: items.filter((i) => !i.isNew && i.notStarted).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
