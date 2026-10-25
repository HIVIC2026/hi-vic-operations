// Jo 23 Oct 2026: the office must see every job an installer brings in (bulk upload, Mitti, portal add, on site).
// No manual "seen" step: a job shows for 7 days after it's added, and stays while something needs the office,
// dropping off by itself once fixed. Pure presentation rules only: never a workflow, eligibility or quote decision.

export const NEW_JOB_DAYS = 7;
export const NOT_STARTED_REMINDER_DAYS = 14;

/** Stages before the Ready Check answers come back; a job past these has clearly started. */
export const PRE_READY_CHECK_STAGES = [
  "new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance",
  "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled",
] as const;

/** Events that prove Ready Check answers have reached the portal from Mitti. */
export const FORM_STARTED_EVENTS = ["ready_check_basics", "mitti_measureup_synced", "mitti_synced"] as const;
/** Office-flagged Mitti events that were previously written to the timeline only. */
export const FLAG_EVENTS = ["mitti_pickup_clash", "mitti_pickup_installer_started_a2", "duplicate_address_linked"] as const;
export const HELD_EVENTS = ["installer_quote_held", "ready_check_needs_office", "quote_auto_send_held"] as const;
/** A quote going to the owner clears an earlier "Quote held" warning. */
export const QUOTE_SENT_EVENTS = ["quote_sent_by_office", "quote_sent_automatically"] as const;
/** Jo 24 Oct: owner said "Not for me"; cleared when the office reopens it. */
export const QUOTE_DECLINE_EVENTS = ["quote_declined", "quote_reopened_by_office"] as const;
/** Office correction that withdraws an earlier A2 note ("recorded in error"). */
export const A2_CORRECTION_EVENT = "mitti_pickup_note_correction";
/** Form creation problems (automatic sweep, earlier flows); cleared by a later created form. */
export const FORM_PROBLEM_EVENTS = ["mitti_autoform_failed", "mitti_access_needed", "mitti_audit_create_uncertain"] as const;
export const FORM_CREATED_EVENTS = ["mitti_audit_created", "mitti_audit_reshared", "mitti_audit_linked"] as const;

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
  isNew: boolean; warnings: string[];
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
  const isNew = ageDays < NEW_JOB_DAYS;
  const started = f.hasQuote || FORM_STARTED_EVENTS.some((t) => types.has(t)) || !(PRE_READY_CHECK_STAGES as readonly string[]).includes(f.stage);

  const warnings: string[] = [];
  const correction = f.events.find((x) => x.type === A2_CORRECTION_EVENT);
  for (const t of FLAG_EVENTS) {
    const e = f.events.find((x) => x.type === t);
    if (e && t === "mitti_pickup_installer_started_a2" && correction && correction.at > e.at) continue;
    if (e) warnings.push(e.summary?.trim() || (t === "mitti_pickup_clash" ? "Possible duplicate of another job" : "Installer started a Home Insulation Victoria form"));
  }
  if (f.eligibility === "does_not_appear_eligible") warnings.push("Eligibility check: does not appear eligible");
  if (!f.hasMittiForm) {
    const created = f.events.find((e) => (FORM_CREATED_EVENTS as readonly string[]).includes(e.type));
    const problem = f.events.find((e) => (FORM_PROBLEM_EVENTS as readonly string[]).includes(e.type) && (!created || e.at > created.at));
    // The automatic form arrives within a tick or two; only a real problem or an hour's wait is worth flagging.
    const settling = now.getTime() - Date.parse(f.createdAt) < 3_600_000;
    if (problem) warnings.push(problem.summary?.trim() || "Mitti Ready Check form could not be created");
    else if (!settling) warnings.push("No Mitti Ready Check form yet");
  }
  const basics = f.events.find((e) => e.type === "ready_check_basics");
  const missing = (basics?.details?.["missing"] as string[] | undefined) ?? [];
  if (basics && missing.length) warnings.push(`Ready Check missing: ${missing.join(", ")}`);
  const sentAt = f.events.find((e) => (QUOTE_SENT_EVENTS as readonly string[]).includes(e.type))?.at ?? "";
  const held = f.events.find((e) => (HELD_EVENTS as readonly string[]).includes(e.type) && e.at > sentAt);
  if (held) {
    const d = held.details ?? {};
    const reasons = ((d["blockers"] as string[] | undefined) ?? (d["reasons"] as string[] | undefined) ?? []).map((r) => r.replace(/^Quote held:\s*/i, ""));
    warnings.push(`Quote held${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
  }
  const dec = f.events.find((e) => (QUOTE_DECLINE_EVENTS as readonly string[]).includes(e.type));
  if (dec?.type === "quote_declined") { const r = (dec.details?.["reason"] as string | undefined) ?? null; warnings.push(`Owner declined the quote${r ? `: ${r}` : ""}`); }
  if (!started && ageDays >= NOT_STARTED_REMINDER_DAYS) warnings.push(`Ready Check not started after ${ageDays} days`);

  if (!isNew && !warnings.length) return null;
  return {
    jobId: f.jobId, jobNumber: f.jobNumber, owner: f.owner, address: f.address, installer: f.installer,
    how: howAdded(f.source), createdAt: f.createdAt, ageDays, mittiAuditId: f.mittiAuditId, isNew, warnings,
  };
}

/** Jobs with something to sort out first (oldest on top), then this week's new jobs (newest on top). */
export function sortNewInstallerJobs(items: NewJobItem[]) {
  return {
    attention: items.filter((i) => i.warnings.length).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    fresh: items.filter((i) => !i.warnings.length).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
