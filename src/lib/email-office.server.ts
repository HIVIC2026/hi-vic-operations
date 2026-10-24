// Office actions on Outlook mail (decisions 245 + 247). Server-only; callers have checked requireAdmin.
// - Match this email (247): file a job-less `email_unmatched` email on a job (re-read from Outlook, stored with the
//   copier's storeOnJob) or mark it "Not a customer". Append-only: the outcome is a new event, never an edit.
// - Email asks for a change (245): Apply performs the change ONLY through existing guarded paths — cancel via the
//   office Cancel path (cancelJobFully, decision 227: reason recorded, install day + installer released), new email via the audited owner email correction,
//   new phone with the same before/after history, attachments → Job File documents; a reschedule is never applied to
//   a booking (the office rearranges it on the job). Ignore records that the office looked and did nothing.
// Nothing here drafts or sends an email or text (decision 244 waits on the connector test).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError, logEvent } from "./workflow.server";
import { EMAIL_UNMATCHED_DISMISSED_EVENT, EMAIL_UNMATCHED_EVENT, EMAIL_UNMATCHED_MATCHED_EVENT, openUnmatched } from "./outlook-guess.core";
import { EMAIL_CHANGE_APPLIED_EVENT, EMAIL_CHANGE_IGNORED_EVENT, EMAIL_CHANGE_REQUEST_EVENT, openChangeRequests, type ChangeIntent } from "./email-intent.core";

const loose = admin as unknown as SupabaseClient;
type Ev = { id: string; job_id: string | null; event_type: string; details: Record<string, unknown> | null; created_at: string; summary: string };

async function eventById(id: string): Promise<Ev | null> {
  const { data, error } = await loose.from("workflow_events").select("id, job_id, event_type, details, created_at, summary").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Ev | null) ?? null;
}

async function resolutionOf(types: string[], key: string, id: string) {
  const { data, error } = await loose.from("workflow_events").select("id, event_type, job_id").in("event_type", types).contains("details", { [key]: id }).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? [])[0] as { id: string; event_type: string; job_id: string | null } | undefined;
}

/** Match this email → file it on `jobId`; or `jobId = null` → "Not a customer" (dismissed, stays in Outlook only). */
export async function matchOutlookEmail(messageEventId: string, jobId: string | null, actorId: string) {
  const ev = await eventById(messageEventId);
  if (!ev || ev.event_type !== EMAIL_UNMATCHED_EVENT) throw new WorkflowError("That email is not waiting to be matched.");
  const d = (ev.details ?? {}) as { message_id?: string; mailbox?: string | null; from?: string | null; subject?: string | null };
  if (!d.message_id) throw new WorkflowError("That email record has no Outlook message id.");
  const done = await resolutionOf([EMAIL_UNMATCHED_MATCHED_EVENT, EMAIL_UNMATCHED_DISMISSED_EVENT], "unmatched_event_id", ev.id);
  if (done) throw new WorkflowError(done.event_type === EMAIL_UNMATCHED_DISMISSED_EVENT ? "That email was already marked Not a customer." : "That email has already been matched.");
  if (jobId === null) {
    const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: EMAIL_UNMATCHED_DISMISSED_EVENT, internal: true,
      summary: `Email from ${d.from ?? "unknown sender"} marked Not a customer — left in Outlook`, details: { unmatched_event_id: ev.id, message_id: d.message_id, reason: "not_a_customer" } });
    if (error) throw new Error(error.message);
    return { ok: true as const, outcome: "dismissed" as const };
  }
  const { data: job } = await admin.from("jobs").select("id, deleted_at, owners(email)").eq("id", jobId).maybeSingle();
  if (!job || job.deleted_at) throw new WorkflowError("That job is not available.");
  // Owner-sent mail stays customer-visible on that job; anyone else (manager, family) is staff-visible only.
  const ownerEmail = ((job as { owners?: { email?: string | null } | null }).owners?.email ?? "").toLowerCase();
  const visibility = ownerEmail && (d.from ?? "").toLowerCase() === ownerEmail ? "customer" as const : "internal" as const;
  const filed = await (await import("./outlook-sync.server")).fileOutlookMessageOnJob({ message_id: d.message_id, mailbox: d.mailbox ?? null }, jobId, visibility);
  await logEvent(jobId, actorId, EMAIL_UNMATCHED_MATCHED_EVENT, `Email from ${d.from ?? "unknown sender"} matched to this job by the office${filed.communicationId ? "" : " (it was already on the job)"}`,
    { unmatched_event_id: ev.id, message_id: d.message_id, communication_id: filed.communicationId, visibility, change_requests: filed.changeRequests }, { internal: true });
  return { ok: true as const, outcome: "matched" as const, communicationId: filed.communicationId, changeRequests: filed.changeRequests };
}

async function updateOwnerPhone(jobId: string, phone: string, reason: string, actorId: string) {
  const { data: job } = await admin.from("jobs").select("owner_id, owners(phone)").eq("id", jobId).maybeSingle();
  if (!job?.owner_id) throw new WorkflowError("Owner not found.");
  const before = (job.owners as { phone: string | null } | null)?.phone ?? null;
  if ((before ?? "").replace(/\D/g, "") === phone.replace(/\D/g, "")) return { ok: true as const, unchanged: true };
  const { error } = await admin.from("owners").update({ phone }).eq("id", job.owner_id);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "owner_phone_corrected", `Owner phone changed from ${before ?? "blank"} to ${phone}: ${reason}`, { before, after: phone, reason }, { internal: true });
  return { ok: true as const, unchanged: false };
}

async function fileAttachments(jobId: string, messageId: string, actorId: string): Promise<number> {
  const { data: rows, error } = await admin.from("job_communications").select("id, attachment_refs").eq("job_id", jobId).eq("provider", "outlook").eq("provider_message_id", messageId);
  if (error) throw new Error(error.message);
  const refs = (rows ?? []).flatMap((r) => ((r.attachment_refs ?? []) as { name?: string; path?: string | null; contentType?: string | null; size?: number | null; isInline?: boolean }[]));
  const files = refs.filter((r) => !!r.path && !r.isInline);
  if (!files.length) throw new WorkflowError("The email's files were not stored (too big or not downloaded yet), so there is nothing to add to the Job File.");
  let added = 0;
  for (const f of files) {
    const { error: ie } = await admin.from("documents").insert({ job_id: jobId, kind: "owner_email_attachment", title: f.name ?? "Email attachment", original_name: (f.name ?? "").slice(0, 300) || null,
      storage_path: f.path!, mime_type: f.contentType ?? null, size_bytes: f.size ?? null, source_system: "outlook", external_id: f.path!, uploaded_by: actorId });
    if (ie) { if (ie.code === "23505") continue; throw new Error(ie.message); }
    added++;
  }
  return added;
}

/** Apply a suggested change (decision 245) through the existing guarded paths only. */
export async function applyEmailChange(eventId: string, actorId: string) {
  const ev = await eventById(eventId);
  if (!ev || ev.event_type !== EMAIL_CHANGE_REQUEST_EVENT || !ev.job_id) throw new WorkflowError("That change request was not found.");
  if (await resolutionOf([EMAIL_CHANGE_APPLIED_EVENT, EMAIL_CHANGE_IGNORED_EVENT], "request_event_id", ev.id)) throw new WorkflowError("That change request has already been dealt with.");
  const d = (ev.details ?? {}) as { intent?: ChangeIntent; message_id?: string; phrase?: string; proposed?: { reason?: string; email?: string | null; phone?: string | null; files?: string[] } };
  const jobId = ev.job_id;
  const why = `owner email ${d.message_id ? `(Outlook ${d.message_id.slice(-12)})` : ""}: “${d.phrase ?? ""}”`.trim();
  let outcome: string;
  let detail: Record<string, unknown> = {};
  switch (d.intent) {
    case "cancel": {
      const { data: job } = await admin.from("jobs").select("stage, deleted_at").eq("id", jobId).maybeSingle();
      if (!job || job.deleted_at) throw new WorkflowError("That job is not available.");
      if (job.stage === "cancelled" || job.stage === "complete") throw new WorkflowError(`The job is already ${job.stage === "cancelled" ? "cancelled" : "complete"}.`);
      // Decision 227 cancel: stops reminders and texts, releases any held install day and the installer, keeps history.
      const { cancelJobFully } = await import("./office-actions.server");
      await cancelJobFully(jobId, `${d.proposed?.reason ?? "Owner asked by email not to go ahead"} — ${why}`.slice(0, 480), actorId, { note: `email change request ${ev.id}` });
      outcome = "cancelled";
      break;
    }
    case "contact_change": {
      const email = d.proposed?.email ?? null, phone = d.proposed?.phone ?? null;
      if (!email && !phone) throw new WorkflowError("No new email address or phone number was found in the email.");
      const reason = `Owner asked by ${why}`.slice(0, 450);
      if (email) await (await import("./hot-leads-send.server")).updateHotLeadEmail(jobId, email, reason, actorId);
      if (phone) await updateOwnerPhone(jobId, phone, reason, actorId);
      outcome = "contact_updated"; detail = { email, phone };
      break;
    }
    case "attachment": {
      if (!d.message_id) throw new WorkflowError("That change request has no Outlook message.");
      detail = { files_added: await fileAttachments(jobId, d.message_id, actorId) };
      outcome = "files_added";
      break;
    }
    case "reschedule":
      // Never move a booking from an email: the office rearranges it on the job (Needs me row only). Apply = "dealt with".
      outcome = "office_rearranges_booking";
      break;
    default:
      throw new WorkflowError("This change can't be applied automatically.");
  }
  await logEvent(jobId, actorId, EMAIL_CHANGE_APPLIED_EVENT, `Email change applied by the office: ${outcome.replace(/_/g, " ")}`, { request_event_id: ev.id, intent: d.intent, message_id: d.message_id ?? null, outcome, ...detail }, { internal: true });
  return { ok: true as const, outcome, ...detail };
}

export async function ignoreEmailChange(eventId: string, actorId: string) {
  const ev = await eventById(eventId);
  if (!ev || ev.event_type !== EMAIL_CHANGE_REQUEST_EVENT || !ev.job_id) throw new WorkflowError("That change request was not found.");
  if (await resolutionOf([EMAIL_CHANGE_APPLIED_EVENT, EMAIL_CHANGE_IGNORED_EVENT], "request_event_id", ev.id)) throw new WorkflowError("That change request has already been dealt with.");
  const d = (ev.details ?? {}) as { intent?: string; message_id?: string };
  await logEvent(ev.job_id, actorId, EMAIL_CHANGE_IGNORED_EVENT, "Email change request ignored by the office (nothing changed)", { request_event_id: ev.id, intent: d.intent ?? null, message_id: d.message_id ?? null }, { internal: true });
  return { ok: true as const };
}

/** Open Needs me email rows: unmatched emails (247) and change requests (245), newest first. Read-only. */
export async function openEmailItems(limit = 200) {
  const [u, ur, c, cr] = await Promise.all([
    loose.from("workflow_events").select("id, job_id, details, created_at, summary").eq("event_type", EMAIL_UNMATCHED_EVENT).order("created_at", { ascending: false }).limit(limit),
    loose.from("workflow_events").select("details").in("event_type", [EMAIL_UNMATCHED_MATCHED_EVENT, EMAIL_UNMATCHED_DISMISSED_EVENT]).order("created_at", { ascending: false }).limit(limit * 4),
    loose.from("workflow_events").select("id, job_id, details, created_at, summary, jobs(job_number, deleted_at)").eq("event_type", EMAIL_CHANGE_REQUEST_EVENT).order("created_at", { ascending: false }).limit(limit),
    loose.from("workflow_events").select("details").in("event_type", [EMAIL_CHANGE_APPLIED_EVENT, EMAIL_CHANGE_IGNORED_EVENT]).order("created_at", { ascending: false }).limit(limit * 4),
  ]);
  const err = u.error ?? ur.error ?? c.error ?? cr.error;
  if (err) throw new Error(`Email items unavailable: ${err.message}`);
  const unmatched = openUnmatched((u.data ?? []) as unknown as Ev[], (ur.data ?? []).map((r) => ({ unmatched_event_id: (r.details as { unmatched_event_id?: string } | null)?.unmatched_event_id })));
  const changes = openChangeRequests((c.data ?? []) as unknown as (Ev & { jobs: { job_number: string; deleted_at: string | null } | null })[], (cr.data ?? []).map((r) => ({ request_event_id: (r.details as { request_event_id?: string } | null)?.request_event_id })))
    .filter((r) => !r.jobs?.deleted_at);
  return {
    unmatched: unmatched.map((e) => ({ eventId: e.id, at: e.created_at, summary: e.summary, ...(e.details ?? {}) })),
    changes: changes.map((e) => ({ eventId: e.id, jobId: e.job_id, jobNumber: e.jobs?.job_number ?? null, at: e.created_at, summary: e.summary, ...(e.details ?? {}) })),
  };
}
