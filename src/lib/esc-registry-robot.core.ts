// ESC VEU Registry robot – PURE decision rules (decision 272, Jo 25 Oct 2026; builds on decision 195). No I/O, no browser.
// The robot does the two Registry submissions the office otherwise does by hand:
//   (1) the pre-installation install notification inside the 24h–5 day window (esc.core window rules), and
//   (2) VEEC creation once the owner has signed the VEEC assignment form and the job is at Ready for VEEC.
// Everything here is a decision: which jobs are due, dry-run vs live, idempotency (never submit twice), and which
// failures the office must pick up. Persistence lives in esc-registry-robot.server.ts; the browser work in
// esc-registry-robot.browser.ts + scripts/esc-registry-robot.ts (a separately run script – the deployed worker
// cannot run a browser).
import { EARLIEST_MS, LEAD_MS, REGISTRY_UPDATABLE_KEYS, registryChange, type RegistryChange } from "./esc.core";

/** workflow_settings column (pending migration docs/pending-migrations/esc-registry-robot-switch.sql; default false). */
export const ESC_ROBOT_SWITCH_COLUMN = "esc_registry_robot_enabled" as const;
/** Deployment flag: "true" lets the robot run at all (second lock next to the office switch). */
export const ESC_ROBOT_ENV_FLAG = "ESC_REGISTRY_ROBOT_ENABLED";
/** Deployment flag: "live" submits; anything else (or unset) is dry-run – fill + screenshot, never press Submit. */
export const ESC_ROBOT_MODE_ENV = "ESC_REGISTRY_ROBOT_MODE";
/** Registry login (Lovable secrets, Jo to provide). Values are never logged, never stored, never put in an event. */
export const ESC_ROBOT_USERNAME_ENV = "VEU_REGISTRY_USERNAME";
export const ESC_ROBOT_PASSWORD_ENV = "VEU_REGISTRY_PASSWORD";

export type RobotTask = "install_notification" | "veec_creation";
export type RobotMode = "off" | "dry_run" | "live";

/** Event names. The two SUCCESS events are the ones the office path already records (esc.server recordEscSubmission /
 *  recordEscRegistryUpdate, portal.functions updateVeec) so every downstream gate (24h rule, AP prerequisites, Final
 *  check) treats a robot submission exactly like a manual one. The robot's own events are internal bookkeeping. */
export const ROBOT_EVENTS = {
  /** Written BEFORE the robot presses Submit, so a crash mid-submit can never lead to a second submission. */
  attempt: "esc_registry_robot_attempt",
  /** Dry run finished: form filled, screenshot stored, nothing submitted. */
  dryRun: "esc_registry_robot_dry_run",
  /** Anything went wrong: screenshot stored, needs_office = true → Needs me row; the office backup takes over. */
  failed: "esc_registry_robot_failed",
  notificationSent: "esc_notification_sent",
  notificationUpdated: "esc_notification_updated",
  veecUpdated: "veec_updated",
} as const;

/** Job File document kinds for the stored screenshots (filed under ESC / VEEC by jobfile.core categoriseDocument). */
export const ROBOT_DOC_KINDS: Record<RobotTask, string> = { install_notification: "esc_registry_notice", veec_creation: "esc_veec_creation" };
/** esc_notifications.submission_method for a robot submission (the robot IS the configured adapter). */
export const ROBOT_SUBMISSION_METHOD = "adapter" as const;
export const ROBOT_ACTOR_LABEL = "esc-registry-robot";

// ---- Mode -------------------------------------------------------------------------------------------------------
export type ModeInput = {
  /** workflow_settings.esc_registry_robot_enabled; null = column missing (pending migration) → off. */
  switchOn: boolean | null;
  /** process.env.ESC_REGISTRY_ROBOT_ENABLED === "true". */
  envOn: boolean;
  /** process.env.ESC_REGISTRY_ROBOT_MODE (only the exact value "live" submits). */
  modeEnv: string | null | undefined;
  /** Both VEU_REGISTRY_USERNAME and VEU_REGISTRY_PASSWORD present (non-empty). */
  credentials: boolean;
};

/** The robot's mode for this run. Fails closed at every step; live needs all four facts. */
export function robotMode(i: ModeInput): { mode: RobotMode; reason: string } {
  if (!i.envOn) return { mode: "off", reason: `${ESC_ROBOT_ENV_FLAG} is not "true" on this deployment` };
  if (i.switchOn === null) return { mode: "off", reason: `Settings switch column ${ESC_ROBOT_SWITCH_COLUMN} is missing (pending migration) – off until the database change is applied` };
  if (!i.switchOn) return { mode: "off", reason: "Settings › Switches › ESC Registry robot is off" };
  if (!i.credentials) return { mode: "off", reason: `Registry login missing (${ESC_ROBOT_USERNAME_ENV} / ${ESC_ROBOT_PASSWORD_ENV})` };
  if (i.modeEnv !== "live") return { mode: "dry_run", reason: `${ESC_ROBOT_MODE_ENV} is not "live" – fill and screenshot only` };
  return { mode: "live", reason: "switch on, deployment live, login present (each task also needs its form checked on the real Registry)" };
}

const TASK_LABEL: Record<RobotTask, string> = { install_notification: "Install notification", veec_creation: "VEEC creation" };

/** Per-task mode: live is downgraded to dry-run for a task whose form was not yet checked on the real Registry
 *  (esc-registry-selectors SELECTORS_VERIFIED). off and dry_run are never changed. */
export function taskMode(mode: RobotMode, task: RobotTask, verified: Record<RobotTask, boolean>): RobotMode {
  return mode === "live" && !verified[task] ? "dry_run" : mode;
}

/** Why a task is downgraded, for logs. */
export const taskNotVerifiedReason = (task: RobotTask) => `${TASK_LABEL[task]} form not yet checked on the real Registry – fill and screenshot only`;

/** TEST (qa_test) jobs never touch the real Registry: live is downgraded to dry-run for them. */
export function jobMode(mode: RobotMode, jobSource: string | null | undefined): RobotMode {
  if (mode === "off") return "off";
  return jobSource === "qa_test" ? "dry_run" : mode;
}

// ---- Idempotency from the robot's own events -------------------------------------------------------------------
export type RobotEvent = { event_type: string; created_at: string; details: unknown };
type RobotDetails = { task?: string; notification_id?: string | null; outcome?: string; mode?: string; needs_office?: boolean };
const det = (e: RobotEvent): RobotDetails => (e.details && typeof e.details === "object" ? (e.details as RobotDetails) : {});

/** The robot's history for ONE target (a notification id, or the job's VEEC creation). */
export function robotHistory(events: RobotEvent[], task: RobotTask, notificationId: string | null): { failed: RobotEvent | null; unfinishedAttempt: RobotEvent | null; dryRuns: number } {
  const mine = events
    .filter((e) => { const d = det(e); return d.task === task && (task === "veec_creation" || (d.notification_id ?? null) === notificationId); })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const failed = [...mine].reverse().find((e) => e.event_type === ROBOT_EVENTS.failed) ?? null;
  // A LIVE attempt with no later outcome (dry run / failed / the success event is recorded on the notice or lodgement
  // itself, which the caller checks first) means the robot may have pressed Submit and crashed: never try again.
  let unfinished: RobotEvent | null = null;
  for (const e of mine) {
    if (e.event_type === ROBOT_EVENTS.attempt && det(e).mode === "live") unfinished = e;
    else if (e.event_type === ROBOT_EVENTS.dryRun || e.event_type === ROBOT_EVENTS.failed) unfinished = null;
  }
  return { failed, unfinishedAttempt: unfinished, dryRuns: mine.filter((e) => e.event_type === ROBOT_EVENTS.dryRun).length };
}

// ---- Install notification --------------------------------------------------------------------------------------
export type NoticeCandidate = {
  jobId: string; jobSource: string | null;
  notificationId: string; version: number; status: string; scheduledStart: string;
  sentAt: string | null; submissionReference: string | null; consentId: string | null;
  /** registryBlock(payload).missing – required Table 5 values still blank (never guessed, never submitted blank). */
  missing: string[];
  payloadJson: unknown;
  /** Latest earlier notice that was sent and not withdrawn (prestart.server latestNotices.previousSent, with payload). */
  previousSent: { id: string; scheduled_start: string; sent_at: string | null; submission_reference: string | null; payload_json: unknown } | null;
  robotEvents: RobotEvent[];
};

export type RobotPlan =
  | { action: "submit"; reason: string }
  | { action: "update_same_id"; reason: string; reference: string; change: RegistryChange }
  | { action: "skip"; reason: string; office?: boolean };

const melb = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Is `now` inside the Registry window for this start (no earlier than 5 days before, no later than 24h before)? */
export function windowState(startIso: string, now: Date): "early" | "open" | "closed" {
  const s = Date.parse(startIso), t = now.getTime();
  if (t < s - EARLIEST_MS) return "early";
  if (t > s - LEAD_MS) return "closed";
  return "open";
}

/** What the robot should do with ONE prepared notice right now. Order matters: already-recorded and office-owned
 *  situations are skipped before any window maths, so a skip never hides a submission the office must know about. */
export function planNotification(c: NoticeCandidate, now: Date): RobotPlan {
  if (c.sentAt && c.submissionReference) return { action: "skip", reason: `already recorded as sent (ref ${c.submissionReference})` };
  if (c.status !== "ready") return { action: "skip", reason: `notice is ${c.status.replace(/_/g, " ")}${c.missing.length ? ` – missing: ${c.missing.join(", ")}` : ""}` };
  if (!c.consentId) return { action: "skip", reason: "no valid separate owner ESC consent is linked" };
  if (c.missing.length) return { action: "skip", reason: `required Registry values missing: ${c.missing.join(", ")}` };
  const h = robotHistory(c.robotEvents, "install_notification", c.notificationId);
  if (h.failed) return { action: "skip", reason: "the robot already failed on this notice – the office submits it by hand (copy the Registry block)", office: true };
  if (h.unfinishedAttempt) return { action: "skip", reason: `a live attempt at ${melb(h.unfinishedAttempt.created_at)} did not finish – check the Registry before anything is resubmitted`, office: true };
  const w = windowState(c.scheduledStart, now);
  if (w === "early") return { action: "skip", reason: `window opens ${melb(new Date(Date.parse(c.scheduledStart) - EARLIEST_MS).toISOString())}` };
  if (w === "closed") return { action: "skip", reason: "window closed (less than 24h before the start) – the office must rebook or submit by hand", office: true };
  if (c.previousSent) {
    const ch = registryChange(c.previousSent, { scheduled_start: c.scheduledStart, payload_json: c.payloadJson }, now.toISOString());
    if (ch.action === "update_same_id" && c.previousSent.submission_reference) return { action: "update_same_id", reason: `update the earlier notification (same ID) – changed: ${ch.changed.join(", ")}`, reference: c.previousSent.submission_reference, change: ch };
    if (ch.action === "withdraw_and_resubmit") return { action: "skip", reason: `the earlier notification must be withdrawn by the office first: ${ch.reasons.join(" ")}`, office: true };
    if (ch.action === "none" && !ch.changed.length) return { action: "skip", reason: "nothing changed against the earlier sent notification – record it as the same submission", office: true };
  }
  return { action: "submit", reason: "ready, consent valid, inside the 24h–5 day window" };
}

/** The Table 5 keys the robot may change on an update (same notification ID). Anything else is refused by registryChange. */
export const ROBOT_UPDATABLE_KEYS = REGISTRY_UPDATABLE_KEYS;

// ---- VEEC creation ---------------------------------------------------------------------------------------------
export type VeecCandidate = {
  jobId: string; jobSource: string | null; stage: string;
  lodgement: { status: string; submission_reference: string | null } | null;
  /** The final VEEC assignment record (customer_assignments record_kind final_veec_assignment, not cancelled). */
  assignment: { status: string; installerSignedAt: string | null; apSignedAt: string | null; consumerSignedAt: string | null } | null;
  /** VEEC quantity from the accepted installation quote (quotes.veec_count). */
  quantity: number | null;
  robotEvents: RobotEvent[];
};

/** VEEC creation is due only after EVERY gate the office path enforces: the job reached Ready for VEEC (a real AP gave
 *  final approval – stageEntryBlockers), the assignment is effective and signed by installer, AP and owner, nothing is
 *  lodged yet, and the quantity is known. The robot never derives a quantity. */
export function planVeecCreation(c: VeecCandidate): RobotPlan {
  if (c.lodgement && c.lodgement.status !== "not_submitted") return { action: "skip", reason: `VEEC already ${c.lodgement.status.replace(/_/g, " ")}${c.lodgement.submission_reference ? ` (ref ${c.lodgement.submission_reference})` : ""}` };
  if (c.stage !== "ready_for_veec") return { action: "skip", reason: `job is not at Ready for VEEC (${c.stage.replace(/_/g, " ")})` };
  if (!c.assignment) return { action: "skip", reason: "no final VEEC assignment record" };
  if (c.assignment.status !== "effective_complete") return { action: "skip", reason: `VEEC assignment is ${c.assignment.status.replace(/_/g, " ")}` };
  if (!c.assignment.installerSignedAt || !c.assignment.apSignedAt || !c.assignment.consumerSignedAt) return { action: "skip", reason: "VEEC assignment not signed by installer, AP and owner" };
  if (c.quantity == null || !Number.isFinite(c.quantity) || c.quantity <= 0) return { action: "skip", reason: "VEEC quantity unknown (no veec_count on the accepted quote)", office: true };
  const h = robotHistory(c.robotEvents, "veec_creation", null);
  if (h.failed) return { action: "skip", reason: "the robot already failed on this VEEC creation – the office lodges it by hand", office: true };
  if (h.unfinishedAttempt) return { action: "skip", reason: `a live attempt at ${melb(h.unfinishedAttempt.created_at)} did not finish – check the Registry before anything is resubmitted`, office: true };
  return { action: "submit", reason: "Ready for VEEC, assignment signed by all three parties, quantity known" };
}

// ---- Records ---------------------------------------------------------------------------------------------------
/** Storage path for a robot screenshot (job-files bucket). `ref` = notification id or "veec"; outcome in the name. */
export function screenshotPath(p: { jobId: string; task: RobotTask; ref: string | null; outcome: "dry_run" | "submitted" | "failed"; at: Date }): string {
  const stamp = p.at.toISOString().replace(/[:.]/g, "-");
  return `${p.jobId}/esc-registry/${p.task}-${(p.ref ?? "veec").slice(0, 8)}-${stamp}-${p.outcome}.png`;
}

export function screenshotTitle(p: { task: RobotTask; outcome: "dry_run" | "submitted" | "failed"; reference?: string | null; jobNumber: string }): string {
  const what = p.task === "install_notification" ? "ESC install notification" : "VEEC creation";
  const how = p.outcome === "dry_run" ? "robot dry run (not submitted)" : p.outcome === "submitted" ? `submitted by robot${p.reference ? ` – ref ${p.reference}` : ""}` : "robot failed (not submitted)";
  return `${what} – ${how} – Job ${p.jobNumber}`;
}

/** The ONE check a Registry reference must pass before it is recorded: non-empty, short, no whitespace runs. */
export function referenceLooksValid(ref: string | null | undefined): ref is string {
  const v = (ref ?? "").trim();
  return v.length >= 3 && v.length <= 64 && !/\s{2,}/.test(v);
}

/** Details stored on the failure event (needs_office drives the Needs me row). Never contains credentials or page HTML. */
export function failureDetails(p: { task: RobotTask; notificationId: string | null; mode: RobotMode; step: string; error: string; screenshotPath: string | null; registryUrl: string | null }) {
  const safeError = p.error.replace(/\s+/g, " ").trim().slice(0, 400);
  return { task: p.task, notification_id: p.notificationId, mode: p.mode, step: p.step, error: safeError, screenshot_path: p.screenshotPath, registry_url: p.registryUrl, needs_office: true, robot: ROBOT_ACTOR_LABEL };
}

/** Plain line for the Needs me row and the job history. */
export function failureLine(d: { task?: string; step?: string; error?: string }): string {
  const what = d.task === "veec_creation" ? "VEEC creation" : "ESC notice";
  return `Registry robot failed · ${what}${d.step ? ` · ${d.step}` : ""}${d.error ? ` · ${d.error.slice(0, 90)}` : ""} · do it by hand`;
}

// ---- Needs me: open failures -----------------------------------------------------------------------------------
export type OpenRobotFailure = { jobId: string; task: RobotTask; at: string; text: string; eventId: string | null };
/** Failures the office still has to act on: cleared the moment the thing was done anyway (notice recorded as sent –
 *  by hand or a later robot run – or the VEEC lodged). Never cleared by time alone. */
export function openRobotFailures(i: {
  failures: (RobotEvent & { id?: string; job_id: string })[];
  /** esc_notifications ids that are recorded as sent (sent_at + reference). */
  sentNotificationIds: Set<string>;
  /** Jobs whose veec_lodgements status is no longer not_submitted. */
  lodgedJobIds: Set<string>;
}): OpenRobotFailure[] {
  const out: OpenRobotFailure[] = [];
  const seen = new Set<string>();
  for (const e of [...i.failures].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const d = det(e);
    if (!d.needs_office) continue;
    const task: RobotTask = d.task === "veec_creation" ? "veec_creation" : "install_notification";
    if (task === "install_notification" && d.notification_id && i.sentNotificationIds.has(d.notification_id)) continue;
    if (task === "veec_creation" && i.lodgedJobIds.has(e.job_id)) continue;
    const key = `${e.job_id}:${task}`;
    if (seen.has(key)) continue; // one row per job + task (latest failure)
    seen.add(key);
    out.push({ jobId: e.job_id, task, at: e.created_at, text: failureLine(d as { task?: string; step?: string; error?: string }), eventId: e.id ?? null });
  }
  return out;
}

/** One-line run summary for the script output and the office log. */
export function runSummary(r: { mode: RobotMode; reason: string; notices: { planned: number; submitted: number; updated: number; dryRuns: number; failed: number; skipped: number }; veecs: { planned: number; submitted: number; dryRuns: number; failed: number; skipped: number } }): string {
  return `ESC Registry robot · mode ${r.mode} (${r.reason}) · notices: ${r.notices.planned} planned, ${r.notices.submitted} submitted, ${r.notices.updated} updated, ${r.notices.dryRuns} dry runs, ${r.notices.failed} failed, ${r.notices.skipped} skipped · VEECs: ${r.veecs.planned} planned, ${r.veecs.submitted} submitted, ${r.veecs.dryRuns} dry runs, ${r.veecs.failed} failed, ${r.veecs.skipped} skipped`;
}
