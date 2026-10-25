// ESC Registry robot – database side (decision 272). Reads what is due, records attempts/dry runs/failures/successes
// and files screenshots on the job. NO browser here and no Playwright import: this module is safe in the deployed
// worker; the browser steps run in scripts/esc-registry-robot.ts, which calls these helpers.
// Success is recorded through the SAME shapes as the office paths (esc.core submissionPatch / registryUpdatePatch on
// esc_notifications, veec_lodgements through veec.core veecUpdateBlockers) and the SAME event names, so the 24h rule,
// the AP prerequisites and Final check cannot tell a robot submission from a manual one. Fails closed everywhere.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent, WorkflowError } from "./workflow.server";
import { registryBlock, registryUpdatePatch, submissionPatch } from "./esc.core";
import {
  ESC_ROBOT_ENV_FLAG, ESC_ROBOT_MODE_ENV, ESC_ROBOT_PASSWORD_ENV, ESC_ROBOT_SWITCH_COLUMN, ESC_ROBOT_USERNAME_ENV, ROBOT_ACTOR_LABEL, ROBOT_DOC_KINDS, ROBOT_EVENTS, ROBOT_SUBMISSION_METHOD,
  failureDetails, failureLine, jobMode, openRobotFailures, planNotification, planVeecCreation, referenceLooksValid, robotMode, screenshotPath, screenshotTitle,
  type NoticeCandidate, type RobotEvent, type RobotMode, type RobotPlan, type RobotTask, type VeecCandidate,
} from "./esc-registry-robot.core";
import { SELECTOR_MAP_VERIFIED } from "./esc-registry-selectors";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROBOT_EVENT_TYPES = [ROBOT_EVENTS.attempt, ROBOT_EVENTS.dryRun, ROBOT_EVENTS.failed];
const DAY = 86_400_000;

// ---- Settings ----------------------------------------------------------------------------------------------------
export type RobotSettings = { mode: RobotMode; reason: string; switchOn: boolean | null; credentials: { username: string; password: string } | null };

/** Switch (fail closed while the column is missing) + env flags + login presence. The password is returned ONLY to the
 *  caller that types it into the page; it is never logged or stored. */
export async function robotSettings(env: NodeJS.ProcessEnv = process.env): Promise<RobotSettings> {
  const switchOn = await robotSwitch();
  const username = (env[ESC_ROBOT_USERNAME_ENV] ?? "").trim(), password = env[ESC_ROBOT_PASSWORD_ENV] ?? "";
  const credentials = username && password ? { username, password } : null;
  const m = robotMode({ switchOn, envOn: env[ESC_ROBOT_ENV_FLAG] === "true", modeEnv: env[ESC_ROBOT_MODE_ENV], credentials: !!credentials, selectorsVerified: SELECTOR_MAP_VERIFIED });
  return { ...m, switchOn, credentials: m.mode === "off" ? null : credentials };
}

/** Settings › Switches › ESC Registry robot: true/false, or null while the pending column is missing (fail closed). */
export async function robotSwitch(): Promise<boolean | null> {
  const { data, error } = await db.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Settings could not be read: ${error.message}`);
  const row = (data ?? null) as Record<string, unknown> | null;
  return row && ESC_ROBOT_SWITCH_COLUMN in row ? row[ESC_ROBOT_SWITCH_COLUMN] === true : null;
}

// ---- Shared reads ------------------------------------------------------------------------------------------------
async function robotEventsFor(jobIds: string[]): Promise<Map<string, RobotEvent[]>> {
  const out = new Map<string, RobotEvent[]>();
  for (let i = 0; i < jobIds.length; i += 150) {
    const chunk = jobIds.slice(i, i + 150);
    const { data, error } = await admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", chunk).in("event_type", ROBOT_EVENT_TYPES).order("created_at", { ascending: true });
    if (error) throw new Error(`Robot history could not be read: ${error.message}`);
    for (const e of data ?? []) { const k = String(e.job_id); out.set(k, [...(out.get(k) ?? []), { event_type: e.event_type, created_at: e.created_at, details: e.details }]); }
  }
  return out;
}

async function jobsById(ids: string[]): Promise<Map<string, { source: string; job_number: string; stage: string }>> {
  const out = new Map<string, { source: string; job_number: string; stage: string }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from("jobs").select("id, source, job_number, stage").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(`Jobs could not be read: ${error.message}`);
    for (const j of data ?? []) out.set(j.id, { source: j.source, job_number: j.job_number, stage: j.stage });
  }
  return out;
}

// ---- Install notifications due --------------------------------------------------------------------------------
export type NoticeWork = {
  candidate: NoticeCandidate; plan: RobotPlan; jobNumber: string; effectiveMode: RobotMode;
  /** Table 5 key → value to type; the two date-times are ISO instants (the browser formats them Melbourne-side). */
  values: Record<string, string | null>;
  /** The copy block the office would paste – kept with dry runs so Jo can compare screenshot and block. */
  registryText: string;
};

/** Every prepared, unsent notice whose start is within the next 6 days, with the robot's plan for each. */
export async function noticeWork(mode: RobotMode, now = new Date()): Promise<NoticeWork[]> {
  const { data: notices, error } = await admin.from("esc_notifications")
    .select("id, job_id, version, status, scheduled_start, sent_at, submission_reference, consent_id, payload_json")
    .is("sent_at", null).not("status", "in", "(cancelled,stale)")
    .gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + 6 * DAY).toISOString())
    .order("scheduled_start", { ascending: true });
  if (error) throw new Error(`ESC notices could not be read: ${error.message}`);
  const rows = notices ?? [];
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((n) => n.job_id))];
  const [jobs, events] = await Promise.all([jobsById(ids), robotEventsFor(ids)]);
  const { latestNotices } = await import("./prestart.server");
  const out: NoticeWork[] = [];
  for (const n of rows) {
    const job = jobs.get(n.job_id);
    if (!job) continue;
    const { previousSent } = await latestNotices(n.job_id);
    let prev: NoticeCandidate["previousSent"] = null;
    if (previousSent) {
      const { data: p } = await admin.from("esc_notifications").select("id, scheduled_start, sent_at, submission_reference, payload_json").eq("id", previousSent.id).maybeSingle();
      if (p) prev = p;
    }
    const payload = (n.payload_json ?? {}) as Record<string, unknown>;
    const block = registryBlock(payload);
    const candidate: NoticeCandidate = {
      jobId: n.job_id, jobSource: job.source, notificationId: n.id, version: n.version, status: n.status, scheduledStart: n.scheduled_start,
      sentAt: n.sent_at, submissionReference: n.submission_reference, consentId: n.consent_id, missing: block.missing, payloadJson: n.payload_json,
      previousSent: prev, robotEvents: events.get(n.job_id) ?? [],
    };
    const values: Record<string, string | null> = Object.fromEntries(block.rows.map((r) => [r.key, r.value]));
    values["installation_start"] = String(payload["scheduled_start"] ?? n.scheduled_start);
    values["installation_end"] = payload["scheduled_end"] ? String(payload["scheduled_end"]) : null;
    out.push({ candidate, plan: planNotification(candidate, now), jobNumber: job.job_number, effectiveMode: jobMode(mode, job.source), values, registryText: block.text });
  }
  return out;
}

// ---- VEEC creation due -----------------------------------------------------------------------------------------
export type VeecWork = { candidate: VeecCandidate; plan: RobotPlan; jobNumber: string; effectiveMode: RobotMode; values: Record<string, string | null> };

/** Jobs at Ready for VEEC with nothing lodged, with the signed assignment's Section 2 values and the quote's VEEC count. */
export async function veecWork(mode: RobotMode): Promise<VeecWork[]> {
  const { data: jobs, error } = await admin.from("jobs").select("id, source, job_number, stage").eq("stage", "ready_for_veec");
  if (error) throw new Error(`Jobs could not be read: ${error.message}`);
  const rows = jobs ?? [];
  if (!rows.length) return [];
  const ids = rows.map((j) => j.id);
  const [events, lodg, asg, quotes] = await Promise.all([
    robotEventsFor(ids),
    admin.from("veec_lodgements").select("job_id, status, submission_reference").in("job_id", ids),
    admin.from("customer_assignments").select("job_id, status, installer_signed_at, ap_signed_at, consumer_signed_at, final_facts").eq("record_kind", "final_veec_assignment").neq("status", "cancelled").in("job_id", ids),
    admin.from("quotes").select("job_id, veec_count, accepted_at").eq("kind", "installation").eq("status", "accepted").in("job_id", ids).order("accepted_at", { ascending: false }),
  ]);
  for (const r of [lodg, asg, quotes]) if (r.error) throw new Error(`VEEC facts could not be read: ${r.error.message}`);
  const out: VeecWork[] = [];
  for (const j of rows) {
    const l = (lodg.data ?? []).find((x) => x.job_id === j.id) ?? null;
    const a = (asg.data ?? []).find((x) => x.job_id === j.id) ?? null;
    const q = (quotes.data ?? []).find((x) => x.job_id === j.id) ?? null;
    const candidate: VeecCandidate = {
      jobId: j.id, jobSource: j.source, stage: j.stage,
      lodgement: l ? { status: l.status, submission_reference: l.submission_reference } : null,
      assignment: a ? { status: String(a.status), installerSignedAt: a.installer_signed_at, apSignedAt: a.ap_signed_at, consumerSignedAt: a.consumer_signed_at } : null,
      quantity: q?.veec_count != null ? Number(q.veec_count) : null,
      robotEvents: events.get(j.id) ?? [],
    };
    const ff = (a?.final_facts ?? {}) as { form_values?: Record<string, unknown>; property_address?: string; completed_date?: string };
    const values: Record<string, string | null> = Object.fromEntries(Object.entries(ff.form_values ?? {}).map(([k, v]) => [k, v == null || v === "" ? null : String(v)]));
    if (!values["installation_address"] && ff.property_address) values["installation_address"] = ff.property_address;
    if (!values["date_completed"] && ff.completed_date) values["date_completed"] = ff.completed_date;
    values["veec_quantity"] = candidate.quantity != null ? String(candidate.quantity) : null;
    out.push({ candidate, plan: planVeecCreation(candidate), jobNumber: j.job_number, effectiveMode: jobMode(mode, j.source), values });
  }
  return out;
}

// ---- Records ---------------------------------------------------------------------------------------------------
/** Written BEFORE Submit is pressed in live mode (and before a dry run, for the trail). */
export async function recordRobotAttempt(p: { jobId: string; task: RobotTask; notificationId: string | null; mode: RobotMode; plan: string }) {
  await logEvent(p.jobId, null, ROBOT_EVENTS.attempt, `Registry robot ${p.mode === "live" ? "is submitting" : "dry run"}: ${p.task === "veec_creation" ? "VEEC creation" : "ESC install notification"} (${p.plan})`, { task: p.task, notification_id: p.notificationId, mode: p.mode, plan: p.plan, robot: ROBOT_ACTOR_LABEL }, { internal: true });
}

/** Stores a screenshot in job-files and files it as a Job File document (kind per task, ESC / VEEC folder). */
export async function storeRobotScreenshot(p: { jobId: string; jobNumber: string; task: RobotTask; ref: string | null; outcome: "dry_run" | "submitted" | "failed"; png: Uint8Array; reference?: string | null; at?: Date }): Promise<string | null> {
  const path = screenshotPath({ jobId: p.jobId, task: p.task, ref: p.ref, outcome: p.outcome, at: p.at ?? new Date() });
  const up = await admin.storage.from("job-files").upload(path, p.png, { contentType: "image/png", upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) { console.error("[esc-registry-robot] screenshot not stored:", up.error.message); return null; }
  const { error } = await admin.from("documents").insert({ job_id: p.jobId, kind: ROBOT_DOC_KINDS[p.task], title: screenshotTitle({ task: p.task, outcome: p.outcome, reference: p.reference ?? null, jobNumber: p.jobNumber }), storage_path: path, mime_type: "image/png", uploaded_by: null, source_system: ROBOT_ACTOR_LABEL, external_id: p.ref, original_name: path.split("/").pop() ?? null, size_bytes: p.png.byteLength });
  if (error) console.error("[esc-registry-robot] document row not written:", error.message);
  return path;
}

export async function recordRobotDryRun(p: { jobId: string; task: RobotTask; notificationId: string | null; screenshotPath: string | null; filled: string[]; blank: string[]; unmapped: string[]; registryUrl: string | null }) {
  await logEvent(p.jobId, null, ROBOT_EVENTS.dryRun, `Registry robot dry run: ${p.task === "veec_creation" ? "VEEC creation" : "ESC install notification"} form filled (${p.filled.length} fields), NOT submitted${p.screenshotPath ? " – screenshot on the job file" : ""}`, { task: p.task, notification_id: p.notificationId, mode: "dry_run", outcome: "dry_run", screenshot_path: p.screenshotPath, filled: p.filled, blank: p.blank, unmapped: p.unmapped, registry_url: p.registryUrl, robot: ROBOT_ACTOR_LABEL }, { internal: true });
}

/** Any failure: internal event with needs_office so Needs me shows it and the office does the submission by hand. */
export async function recordRobotFailure(p: { jobId: string; task: RobotTask; notificationId: string | null; mode: RobotMode; step: string; error: string; screenshotPath: string | null; registryUrl: string | null }) {
  const details = failureDetails(p);
  await logEvent(p.jobId, null, ROBOT_EVENTS.failed, `${failureLine(details)}. Needs Home Insulation Victoria`, details, { internal: true });
}

/** Robot submitted a NEW install notification. Same patch as the office record, method "adapter", no profile actor. */
export async function recordRobotNotificationSubmitted(p: { notificationId: string; reference: string; sentAt: string; screenshotPath: string | null; registryUrl: string | null }) {
  if (!referenceLooksValid(p.reference)) throw new WorkflowError("The Registry reference read from the page does not look like a reference.");
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", p.notificationId).single();
  if (!n) throw new WorkflowError("Notification not found");
  if (n.sent_at || n.submission_reference) throw new WorkflowError(`Notification is already recorded as sent (ref ${n.submission_reference}).`);
  if (n.status !== "ready") throw new WorkflowError(`Cannot record a robot submission for a ${n.status.replace("_", " ")} notification.`);
  if (!n.consent_id) throw new WorkflowError("Cannot notify ESC: no valid separate owner consent is linked to this notification.");
  const { assertCanSubmit } = await import("./esc.server");
  await assertCanSubmit(n, p.sentAt);
  const patch = submissionPatch({ reference: p.reference, sentAt: p.sentAt, method: ROBOT_SUBMISSION_METHOD, confirmed: true, actorId: ROBOT_ACTOR_LABEL }, new Date().toISOString());
  const response = { ...((n.response && typeof n.response === "object" ? n.response : {}) as Record<string, unknown>), robot: { submitted_at: p.sentAt, screenshot_path: p.screenshotPath, registry_url: p.registryUrl, by: ROBOT_ACTOR_LABEL } };
  // Idempotent write: only the still-unsent row takes the patch (a concurrent office record wins and we throw).
  const { data: upd, error } = await admin.from("esc_notifications").update({ ...patch, submitted_by: null, response: response as Json, updated_at: new Date().toISOString() }).eq("id", n.id).is("sent_at", null).select("id");
  if (error) throw new WorkflowError(error.message);
  if (!upd?.length) throw new WorkflowError("The notification was recorded by someone else a moment ago; nothing changed.");
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_submitted")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  await logEvent(n.job_id, null, ROBOT_EVENTS.notificationSent, `ESC notification submitted in the VEU Registry by the robot (ref ${patch.submission_reference}, at ${p.sentAt})`, { notification_id: n.id, ...patch, submitted_by: null, robot: ROBOT_ACTOR_LABEL, screenshot_path: p.screenshotPath, task: "install_notification", outcome: "submitted" });
}

/** Robot UPDATED the earlier notification on the same Registry ID (esc.core registryChange said update_same_id). */
export async function recordRobotNotificationUpdated(p: { notificationId: string; previousNotificationId: string; reference: string; updatedAt: string; screenshotPath: string | null; registryUrl: string | null }) {
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", p.notificationId).single();
  if (!n) throw new WorkflowError("Notification not found");
  if (n.sent_at || n.submission_reference) throw new WorkflowError(`Notification is already recorded as sent (ref ${n.submission_reference}).`);
  if (n.status !== "ready" || !n.consent_id) throw new WorkflowError("Notification is not ready or has no valid consent.");
  const { data: prev } = await admin.from("esc_notifications").select("scheduled_start, sent_at, submission_reference, payload_json").eq("id", p.previousNotificationId).single();
  if (!prev) throw new WorkflowError("The earlier notification could not be read.");
  const { assertCanSubmit } = await import("./esc.server");
  await assertCanSubmit(n, p.updatedAt);
  const now = new Date().toISOString();
  const { registryChange } = await import("./esc.core");
  let patch;
  try { patch = registryUpdatePatch({ prev, change: registryChange(prev, { scheduled_start: n.scheduled_start, payload_json: n.payload_json }, now), reference: p.reference, updatedAt: p.updatedAt, confirmed: true, actorId: ROBOT_ACTOR_LABEL }, now); } catch (e) { throw new WorkflowError((e as Error).message); }
  const response = { ...patch.response, robot: { updated_at: p.updatedAt, screenshot_path: p.screenshotPath, registry_url: p.registryUrl, by: ROBOT_ACTOR_LABEL } };
  const { data: upd, error } = await admin.from("esc_notifications").update({ ...patch, submission_method: ROBOT_SUBMISSION_METHOD, submitted_by: null, response: response as unknown as Json, updated_at: now }).eq("id", n.id).is("sent_at", null).select("id");
  if (error) throw new WorkflowError(error.message);
  if (!upd?.length) throw new WorkflowError("The notification was recorded by someone else a moment ago; nothing changed.");
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_submitted")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  await logEvent(n.job_id, null, ROBOT_EVENTS.notificationUpdated, `ESC notification updated in the VEU Registry by the robot (same ID ${patch.submission_reference}, at ${p.updatedAt}): ${patch.response.registry_update.changed.join(", ")}`, { notification_id: n.id, previous_notification_id: p.previousNotificationId, ...patch.response.registry_update, robot: ROBOT_ACTOR_LABEL, screenshot_path: p.screenshotPath, task: "install_notification", outcome: "submitted" }, { internal: true });
}

/** Robot created the VEECs: the lodgement becomes "submitted" through the same rules as the office form (veec.core). */
export async function recordRobotVeecSubmitted(p: { jobId: string; reference: string; quantity: number; submittedDate: string; screenshotPath: string | null; registryUrl: string | null }) {
  if (!referenceLooksValid(p.reference)) throw new WorkflowError("The Registry reference read from the page does not look like a reference.");
  const { getStage } = await import("./workflow.server");
  if (!["ready_for_veec", "complete"].includes(await getStage(p.jobId))) throw new WorkflowError("VEEC can only be lodged once the job is Ready for VEEC.");
  const { data: prev } = await admin.from("veec_lodgements").select("status,quantity,submission_reference,submitted_date,notes").eq("job_id", p.jobId).maybeSingle();
  if (prev && prev.status !== "not_submitted") throw new WorkflowError(`VEEC is already ${prev.status.replace("_", " ")}.`);
  const next = { status: "submitted" as const, quantity: p.quantity, submission_reference: p.reference.trim(), submitted_date: p.submittedDate, notes: prev?.notes ?? null };
  const { veecUpdateBlockers, melbourneToday } = await import("./veec.core");
  const blockers = veecUpdateBlockers(prev, next, melbourneToday());
  if (blockers.length) throw new WorkflowError(blockers.join(" "));
  const { data: upd, error } = await admin.from("veec_lodgements").update({ ...next, updated_at: new Date().toISOString() }).eq("job_id", p.jobId).eq("status", "not_submitted").select("id");
  if (error) throw new WorkflowError(error.message);
  if (!upd?.length) throw new WorkflowError("The VEEC lodgement was recorded by someone else a moment ago; nothing changed.");
  await logEvent(p.jobId, null, ROBOT_EVENTS.veecUpdated, `VEEC lodgement submitted – created in the VEU Registry by the robot (ref ${next.submission_reference}, ${p.quantity} VEECs)`, { ...next, previous: prev, reason: "Created in the VEU Registry by the robot", robot: ROBOT_ACTOR_LABEL, screenshot_path: p.screenshotPath, registry_url: p.registryUrl, task: "veec_creation", outcome: "submitted" }, { internal: true });
  await import("./autoadvance.server").then((m) => m.autoAdvanceJob(p.jobId, null, "VEEC created by robot")).catch((e) => console.error("auto-advance skipped", (e as Error).message));
}

// ---- Needs me --------------------------------------------------------------------------------------------------
/** Open robot failures (needs_office, not yet done by hand) for the Needs me list; optionally limited to some jobs. */
export async function openRobotFailureRows(onlyIds?: string[]) {
  let q = admin.from("workflow_events").select("id, job_id, event_type, created_at, details").eq("event_type", ROBOT_EVENTS.failed).contains("details", { needs_office: true }).order("created_at", { ascending: false }).limit(500);
  if (onlyIds) q = q.in("job_id", onlyIds);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load robot failures: ${error.message}`);
  const failures = (data ?? []).filter((e) => e.job_id).map((e) => ({ id: e.id, job_id: String(e.job_id), event_type: e.event_type, created_at: e.created_at, details: e.details }));
  if (!failures.length) return [];
  const jobIds = [...new Set(failures.map((f) => f.job_id))];
  const noticeIds = [...new Set(failures.map((f) => (f.details as { notification_id?: string } | null)?.notification_id).filter((x): x is string => !!x))];
  const [sent, lodged] = await Promise.all([
    noticeIds.length ? admin.from("esc_notifications").select("id").in("id", noticeIds).not("sent_at", "is", null).not("submission_reference", "is", null) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    admin.from("veec_lodgements").select("job_id").in("job_id", jobIds).neq("status", "not_submitted"),
  ]);
  return openRobotFailures({ failures, sentNotificationIds: new Set((sent.data ?? []).map((r) => r.id)), lodgedJobIds: new Set((lodged.data ?? []).map((r) => r.job_id)) });
}
