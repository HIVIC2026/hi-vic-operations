// Decision 337 (Jo, 25 Oct 2026): the automatic reply to a MATCHED owner's "change the day / cancel" email. Called by
// the Outlook copier's decision-245 step (outlook-sync.server `recordChangeRequests`) for a reschedule or cancel intent.
// - Decision: pure `planChangeReply` (email-change-reply.core) over read-only facts: one matched job, the sender is the
//   owner on file, the stage's visit can be changed on My job right now (the owner screens' own state), the owner's
//   secure link, `ownerCanCancel` (My job's own cancel rule) and any earlier claim for this job + message.
// - Mode: TEST jobs → test-send only; real owners → `sendGuardedOwnerEmail` (opt-outs, suppression, recipient boundary,
//   once-only ledger key) after `assertCustomerDeliveryAllowed` (customer_comms_enabled + consent), behind
//   EMAIL_CHANGE_REPLY_APPROVED. Never Outlook send/sendMail/reply (decision 244); never a draft — this reply is sent.
// - Records: ONE `email_change_replied` per job + message written BEFORE the send (the claim); a reply that could not go
//   adds `email_change_reply_held`, and the caller then raises the decision-245 office row as before.
// Nothing here changes a booking, a stage or the job: the owner does that on My job, and those flows tell the trade.
// Best-effort: never throws to the copier (the caller treats any failure as "raise the office row").
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { MailMessage } from "./outlook-correspondence.core";
import {
  EMAIL_CHANGE_REPLIED_EVENT, EMAIL_CHANGE_REPLY_APPROVED, EMAIL_CHANGE_REPLY_HELD_EVENT, EMAIL_CHANGE_REPLY_PURPOSE, EMAIL_CHANGE_REPLY_TEMPLATE,
  CHANGE_VISIT, changeReplyFirstName, changeReplyKey, changeReplyMode, changeVisitLink, planChangeReply, renderChangeReplyEmail, visitGroupForStage,
  type VisitAvailability,
} from "./email-change-reply.core";

export type ChangeReplyOutcome = { sent: boolean; keepOfficeRow: boolean; status: "sent" | "already" | "held" | "office"; detail: string };

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** What My job can change right now, read only for the visit the stage is about (the same state the owner screens show). */
async function availability(jobId: string, stage: string): Promise<VisitAvailability> {
  const out: VisitAvailability = { readyCheck: false, piesa: false, install: false };
  const group = visitGroupForStage(stage);
  if (group === "ready_check") {
    const s = await (await import("./ready-check-times.server")).ownerReadyCheckTimesState(jobId) as { applies: boolean; allowed?: boolean; turn?: string; canChange?: boolean };
    out.readyCheck = !!s.applies && !!s.allowed && ((s.turn === "booked" && !!s.canChange) || s.turn === "owner_to_answer");
  } else if (group === "piesa") {
    const [w, b] = await Promise.all([
      (await import("./allocation.server")).ownerPiesaWindowState(jobId),
      (await import("./visit-events.server")).ownerPiesaBookingState(jobId),
    ]);
    out.piesa = w.canPick || !!b?.canChange;
  } else if (group === "install") {
    const s = await (await import("./install-days.server")).ownerInstallDayState(jobId);
    out.install = s.turn === "owner_to_answer" || (s.turn === "booked" && stage === "installation_booked" && !!s.bookedAt && Date.parse(s.bookedAt) > Date.now());
  }
  return out;
}

async function prior(jobId: string, messageId: string): Promise<"none" | "sent" | "held"> {
  const { data, error } = await admin.from("workflow_events").select("event_type").eq("job_id", jobId).in("event_type", [EMAIL_CHANGE_REPLIED_EVENT, EMAIL_CHANGE_REPLY_HELD_EVENT]).contains("details", { message_id: messageId }).limit(5);
  if (error) throw new Error(error.message);
  const types = (data ?? []).map((r) => r.event_type);
  if (types.includes(EMAIL_CHANGE_REPLY_HELD_EVENT)) return "held";
  return types.includes(EMAIL_CHANGE_REPLIED_EVENT) ? "sent" : "none";
}

export async function replyToChangeRequest(p: { jobIds: string[]; message: MailMessage; intent: string; fromPartner: boolean }): Promise<ChangeReplyOutcome> {
  const m = p.message;
  const office = (detail: string): ChangeReplyOutcome => ({ sent: false, keepOfficeRow: true, status: "office", detail });
  if (p.jobIds.length !== 1) return office("the email matches more than one job");
  const jobId = p.jobIds[0]!;
  try {
    const { data: job, error: je } = await admin.from("jobs").select("id, stage, source, owner_id, deleted_at").eq("id", jobId).maybeSingle();
    if (je) throw new Error(je.message);
    if (!job || job.deleted_at) return office("job not found");
    const [{ data: owner }, { data: bk }, link, before] = await Promise.all([
      job.owner_id ? admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle() : Promise.resolve({ data: null as { full_name: string | null; email: string | null } | null }),
      // Same booking statuses My job uses for its own cancel rule (owner-myjob.server).
      admin.from("bookings").select("kind").eq("job_id", jobId).in("status", ["proposed", "confirmed"]),
      (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
      prior(jobId, m.providerMessageId),
    ]);
    const { ownerCanCancel } = await import("./owner-myjob.core");
    const ownerCanSelfCancel = ownerCanCancel(job.stage, (bk ?? []).map((b) => b.kind));
    const senderIsOwner = !!owner?.email && lower(owner.email) === lower(m.from);
    const avail = senderIsOwner && before === "none" ? await availability(jobId, job.stage) : { readyCheck: false, piesa: false, install: false };
    const plan = planChangeReply({ intent: p.intent, jobIds: p.jobIds, senderIsOwner, fromPartner: p.fromPartner, testJob: job.source === "qa_test", stage: job.stage, avail, ownerCanSelfCancel, hasLink: !!link, prior: before });
    if (plan.kind === "office") return office(plan.reason);
    if (plan.kind === "already") return { sent: true, keepOfficeRow: plan.keepOfficeRow, status: "already", detail: "already replied to this email" };

    const testJob = job.source === "qa_test";
    const commsEnabled = testJob ? null : await (await import("./comms.server")).customerCommsEnabled().catch(() => false);
    const mode = changeReplyMode({ testJob, approved: EMAIL_CHANGE_REPLY_APPROVED, commsEnabled });
    if (mode.mode === "held") return office(mode.reason); // nothing claimed: the office row is raised as before

    const key = changeReplyKey(jobId, m.providerMessageId);
    const facts = { firstName: changeReplyFirstName(owner?.full_name, m.fromName), visit: plan.visit, link: changeVisitLink(link!, plan.visit), cancelNote: plan.cancelNote };
    const base = { message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, intent: p.intent, visit: plan.visit, screen: CHANGE_VISIT[plan.visit].screen,
      cancel_note: plan.cancelNote !== "", keep_office_row: plan.keepOfficeRow, template: EMAIL_CHANGE_REPLY_TEMPLATE, key, mode: mode.mode, decision: 337 };
    const { logEvent } = await import("./workflow.server");
    // The claim: one per job + message, written before anything is sent.
    await logEvent(jobId, null, EMAIL_CHANGE_REPLIED_EVENT, `Owner emailed to ${p.intent === "cancel" ? "cancel" : "change the day"} — automatic reply with their My job link (${CHANGE_VISIT[plan.visit].visit}) prepared`, base, { internal: true });
    const to = owner!.email!.trim();
    let status: string;
    if (mode.mode === "test_send") {
      const mail = renderChangeReplyEmail({ ...facts, theirSubject: m.subject, test: true });
      const { sendTestEmail } = await import("./test-send.server");
      const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${EMAIL_CHANGE_REPLY_PURPOSE}:${key}`, actorId: null }, to, mail.subject, mail.html, mail.text);
      status = r.status === "sent" ? "sent" : `test-send ${r.status}: ${r.detail}`;
    } else {
      try {
        await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Change-day email reply");
        status = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: EMAIL_CHANGE_REPLY_PURPOSE, key,
          build: (unsubscribe) => renderChangeReplyEmail({ ...facts, theirSubject: m.subject, unsubscribe }) });
      } catch (e) { status = `blocked: ${(e as Error).message}`; }
    }
    const sent = status === "sent" || status.startsWith("delivery uncertain");
    if (!sent) {
      await logEvent(jobId, null, EMAIL_CHANGE_REPLY_HELD_EVENT, `Automatic reply to the owner's change email not sent — ${status}`, { ...base, status }, { internal: true });
      return office(status);
    }
    return { sent: true, keepOfficeRow: plan.keepOfficeRow, status: "sent", detail: status };
  } catch (e) {
    console.error("email change reply skipped", e instanceof Error ? e.message : e);
    return office(e instanceof Error ? e.message : "change reply failed");
  }
}
