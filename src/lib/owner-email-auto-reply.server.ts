// Decision 386 (Jo 25 Oct 2026, "Auto-send simple ones"): the automatic reply to a MATCHED OWNER's standard question.
// Called by the Outlook copier (outlook-sync.server `ownerAutoReply`) right after the decision-245/337 step and BEFORE
// the decision-244 reply draft, for new inbound mail filed on a job (sync, or the office's "Match this email").
// - Decision: pure `decideOwnerAutoReply` (owner-email-auto-reply.core) over read-only facts: the sender is the owner
//   on file (never a partner, worker, applicant or staff member), the job's stage, spot saved, the three questions
//   answered, the next confirmed visit, the sent quote, and the owner's own links from the ACTIVE step3_estimate
//   customer_estimate_links row. Change / cancel asks are left to decisions 245/337 (`skip`).
// - Mode (as decision 337): TEST jobs → test-send only; real owners → `sendGuardedOwnerEmail` (opt-outs, suppression,
//   recipient boundary, once-only ledger key; Resend with Reply-To info@) after `assertCustomerDeliveryAllowed`
//   (customer_comms_enabled + consent), behind OWNER_EMAIL_AUTO_REPLY_APPROVED (false until Jo approves O76).
//   Never Outlook send/sendMail/reply.
// - Records: ONE `email_auto_replied` per Outlook message (key `owner-email-auto-reply:v1:<message id>`, unique index
//   in pending migration owner-email-auto-reply-events.sql) written BEFORE the send; a reply that could not go adds
//   `email_auto_reply_held`. Not sent (draft / held) → the caller writes the decision-244 draft as before and this module
//   raises ONE Needs me email row (`email_change_request`, intent "reply", Done / Ignore).
// - Filing: after a SENT reply the inbound message is moved to Outlook Archive (email-reply.server
//   `archiveRepliedMessage`, behind OUTLOOK_ARCHIVE_AFTER_REPLY_ENABLED) and `email_auto_reply_filed` records the result.
// Nothing here changes a job, a booking or a stage. Best-effort: never throws to the copier.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailMessage } from "./outlook-correspondence.core";
import { EMAIL_CHANGE_REQUEST_EVENT, recentEnoughForAction } from "./email-intent.core";
import {
  ANSWER_CODES, EMAIL_AUTO_REPLIED_EVENT, EMAIL_AUTO_REPLY_FILED_EVENT, EMAIL_AUTO_REPLY_HELD_EVENT, OWNER_EMAIL_AUTO_REPLY_APPROVED,
  OWNER_EMAIL_AUTO_REPLY_PURPOSE, REPLY_NEEDED_INTENT, autoReplyKey, autoReplyMode, decideOwnerAutoReply, renderOwnerAutoReplyEmail,
  type OwnerJobFacts, type VisitKind,
} from "./owner-email-auto-reply.core";

const loose = admin as unknown as SupabaseClient;
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const exactEmail = (email: string) => email.replace(/[%_\\,()*]/g, "");

export type AutoReplyOutcome = {
  status: "sent" | "already" | "none" | "draft" | "held" | "skip";
  detail: string;
  /** True when the decision-244 draft must NOT be written (a reply went, or none is needed). */
  suppressDraft: boolean;
  /** A Needs me "reply needed" row was raised (or already existed) for this email. */
  officeRow: boolean;
};

const BOOKING_VISIT: Record<string, VisitKind> = { ready_check: "ready_check", assessment: "piesa", installation: "install" };

/** Partner businesses (and their signers), partner workers, partner applicants and staff are never answered here. */
async function partnerOrStaff(email: string): Promise<boolean> {
  const e = exactEmail(email);
  const rs = await Promise.all([
    admin.from("businesses").select("id").ilike("email", e).limit(1),
    admin.from("businesses").select("id").ilike("signer_email", e).limit(1),
    admin.from("partner_workers").select("id").ilike("email", e).limit(1),
    admin.from("partner_enquiries").select("id").ilike("email", e).limit(1),
    admin.from("profiles").select("id").ilike("email", e).limit(1),
  ]);
  for (const r of rs) if (r.error) throw new Error(r.error.message);
  return rs.some((r) => (r.data ?? []).length > 0);
}

/** The owner's job facts for the classifier — read-only, nothing minted or refreshed. */
export async function ownerJobFacts(jobId: string, ownerFullName: string | null, stage: string, now = new Date()): Promise<OwnerJobFacts> {
  const [spot, answered, books, quotes, link] = await Promise.all([
    loose.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", jobId).maybeSingle(),
    loose.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "owner_insulation_details_answered").limit(1),
    admin.from("bookings").select("kind, status, scheduled_start, scheduled_end").eq("job_id", jobId).eq("status", "confirmed").order("scheduled_start", { ascending: true }),
    admin.from("quotes").select("kind, status, created_at").eq("job_id", jobId).eq("kind", "installation").in("status", ["issued", "accepted", "declined"]).order("created_at", { ascending: false }).limit(1),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
  ]);
  for (const r of [answered, books, quotes]) if (r.error) throw new Error(r.error.message);
  const { linkUsable } = await import("./estimatelink.core");
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const l = link.error ? null : (link.data as { token: string; status: string; expires_at: string } | null);
  const usable = !!l && linkUsable(l, now.getTime());
  const upcoming = ((books.data ?? []) as { kind: string; scheduled_start: string | null; scheduled_end: string | null }[])
    .filter((b) => b.scheduled_start && BOOKING_VISIT[b.kind] && Date.parse(b.scheduled_end ?? b.scheduled_start) > now.getTime())[0] ?? null;
  const q = ((quotes.data ?? []) as { status: string }[])[0] ?? null;
  return {
    stage, ownerFullName,
    spotSaved: !spot.error && !!spot.data?.spot_saved_at && !spot.data.opted_out_at,
    questionsAnswered: (answered.data ?? []).length > 0,
    nextVisit: upcoming ? { kind: BOOKING_VISIT[upcoming.kind]!, slot: { start: upcoming.scheduled_start!, end: upcoming.scheduled_end } } : null,
    quoteStatus: q ? (q.status as "issued" | "accepted" | "declined") : null,
    myJobLink: usable ? `${CUSTOMER_BASE}/my-job/${l!.token}` : null,
    questionsLink: usable ? `${CUSTOMER_BASE}/estimate/${l!.token}/video` : null,
  };
}

async function prior(messageId: string): Promise<"none" | "sent" | "held"> {
  const { data, error } = await loose.from("workflow_events").select("event_type").in("event_type", [EMAIL_AUTO_REPLIED_EVENT, EMAIL_AUTO_REPLY_HELD_EVENT]).contains("details", { message_id: messageId }).limit(5);
  if (error) throw new Error(error.message);
  const types = (data ?? []).map((r) => (r as { event_type: string }).event_type);
  if (types.includes(EMAIL_AUTO_REPLY_HELD_EVENT)) return "held";
  return types.includes(EMAIL_AUTO_REPLIED_EVENT) ? "sent" : "none";
}

/** ONE Needs me email row per message (decision-245 row, intent "reply"): "Owner emailed — reply needed". Idempotent. */
export async function raiseReplyNeededRow(jobId: string, m: MailMessage, reason: string): Promise<boolean> {
  const { data: dup, error: de } = await loose.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", EMAIL_CHANGE_REQUEST_EVENT).contains("details", { message_id: m.providerMessageId, intent: REPLY_NEEDED_INTENT }).limit(1);
  if (de) throw new Error(de.message);
  if ((dup ?? []).length) return true;
  const phrase = (m.subject ?? "").trim().slice(0, 80) || reason;
  const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: EMAIL_CHANGE_REQUEST_EVENT, internal: true,
    summary: `Owner emailed — reply needed (${reason}); check the reply draft in Outlook and send it, then tap Done`,
    details: { message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, from: m.from, subject: m.subject, received_at: m.at,
      intent: REPLY_NEEDED_INTENT, phrase, reason, label: "Owner emailed — reply needed", decision: 386 } });
  if (error) throw new Error(error.message);
  return true;
}

/** Tests only pass `switches`; production uses the code constants. */
export async function autoReplyToOwner(p: { jobIds: string[]; message: MailMessage; mailbox: string | null; now?: Date; switches?: { approved: boolean; archive: boolean } }): Promise<AutoReplyOutcome> {
  const m = p.message, now = p.now ?? new Date();
  const approved = p.switches?.approved ?? OWNER_EMAIL_AUTO_REPLY_APPROVED;
  const skip = (detail: string): AutoReplyOutcome => ({ status: "skip", detail, suppressDraft: false, officeRow: false });
  if (m.direction !== "inbound" || !p.jobIds.length) return skip("not a matched inbound email");
  if (!recentEnoughForAction(m.at, now)) return skip("too old for an automatic reply");
  const jobId = p.jobIds[0]!;
  const draft = async (status: "draft" | "held", detail: string): Promise<AutoReplyOutcome> => ({ status, detail, suppressDraft: false, officeRow: await raiseReplyNeededRow(jobId, m, detail) });
  try {
    const { data: job, error: je } = await admin.from("jobs").select("id, stage, source, owner_id, deleted_at").eq("id", jobId).maybeSingle();
    if (je) throw new Error(je.message);
    if (!job || job.deleted_at) return skip("job not found");
    const { data: owner } = job.owner_id ? await admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle() : { data: null as { full_name: string | null; email: string | null } | null };
    const from = lower(m.from);
    const senderIsOwner = !!owner?.email && !!from && lower(owner.email) === from;
    // Cheapest guard first: someone other than the owner on file → the existing path, nothing read further.
    if (!senderIsOwner) return skip("sender is not the owner on file");
    const before = await prior(m.providerMessageId);
    if (before === "sent") return { status: "already", detail: "already replied to this email", suppressDraft: true, officeRow: false };
    if (before === "held") return { status: "already", detail: "the automatic reply was held earlier", suppressDraft: false, officeRow: await raiseReplyNeededRow(jobId, m, "the automatic reply was held earlier") };
    const [isPartnerOrStaff, facts] = await Promise.all([partnerOrStaff(from), ownerJobFacts(jobId, owner?.full_name ?? null, job.stage, now)]);
    const decision = decideOwnerAutoReply({
      subject: m.subject, body: m.body, fromName: m.fromName, hasAttachments: m.hasAttachments,
      attachments: (m.attachments ?? []).map((a) => ({ name: a.name, contentType: a.contentType, isInline: a.isInline })),
      jobCount: p.jobIds.length, senderIsOwner, senderIsPartnerOrStaff: isPartnerOrStaff, job: facts,
    });
    if (decision.kind === "skip") return skip(decision.reason);
    if (decision.kind === "none") return { status: "none", detail: decision.reason, suppressDraft: true, officeRow: false };
    if (decision.kind === "draft") return draft("draft", decision.reason);

    const testJob = job.source === "qa_test";
    const commsEnabled = testJob || !approved ? null : await (await import("./comms.server")).customerCommsEnabled().catch(() => false);
    const mode = autoReplyMode({ testJob, approved, commsEnabled });
    if (mode.mode === "held") return draft("held", mode.reason); // nothing claimed, nothing sent

    const key = autoReplyKey(m.providerMessageId);
    const code = ANSWER_CODES[decision.answer].code;
    const base = { message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, from, subject: m.subject, received_at: m.at,
      answer: decision.answer, template: code, link: decision.link, idempotency_key: key, mode: mode.mode, decision: 386 };
    // The claim: one per Outlook message, written before anything is sent (unique key once the pending index is applied).
    const claim = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: EMAIL_AUTO_REPLIED_EVENT, internal: true,
      summary: `${testJob ? "TEST " : ""}Owner's email answered automatically (${code} ${ANSWER_CODES[decision.answer].name})`, details: base });
    if (claim.error) {
      if (claim.error.code === "23505") return { status: "already", detail: "already replied to this email", suppressDraft: true, officeRow: false };
      throw new Error(`Automatic reply not claimed: ${claim.error.message}`);
    }
    const to = owner!.email!.trim();
    let status: string;
    if (mode.mode === "test_send") {
      const mail = renderOwnerAutoReplyEmail({ answer: decision.answer, facts: decision.facts, theirSubject: m.subject, test: true });
      const { sendTestEmail } = await import("./test-send.server");
      const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${OWNER_EMAIL_AUTO_REPLY_PURPOSE}:${key}`, actorId: null }, to, mail.subject, mail.html, mail.text);
      status = r.status === "sent" ? "sent" : `test-send ${r.status}: ${r.detail}`;
    } else {
      try {
        await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Automatic email reply");
        status = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: OWNER_EMAIL_AUTO_REPLY_PURPOSE, key,
          build: (unsubscribe) => renderOwnerAutoReplyEmail({ answer: decision.answer, facts: decision.facts, theirSubject: m.subject, unsubscribe }) });
      } catch (e) { status = `blocked: ${(e as Error).message}`; }
    }
    const sent = status === "sent" || status.startsWith("delivery uncertain");
    if (!sent) {
      await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: EMAIL_AUTO_REPLY_HELD_EVENT, internal: true,
        summary: `Automatic reply to the owner's email not sent — ${status}`, details: { ...base, status } });
      return draft("held", status);
    }
    // Filed: the replied conversation leaves the Inbox (switch off → it stays where it is; nothing recorded).
    const { archiveRepliedMessage } = await import("./email-reply.server");
    const filed = await archiveRepliedMessage({ mailbox: p.mailbox, messageId: m.providerMessageId, ...(p.switches ? { enabled: p.switches.archive } : {}) });
    if (filed.status !== "skipped") {
      await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: EMAIL_AUTO_REPLY_FILED_EVENT, internal: true,
        summary: filed.status === "archived" ? "Owner's email filed in Outlook Archive after the automatic reply" : `Owner's email not filed in Outlook Archive — ${filed.detail}`,
        details: { message_id: m.providerMessageId, idempotency_key: key, status: filed.status, detail: filed.detail, decision: 386 } });
    }
    return { status: "sent", detail: status, suppressDraft: true, officeRow: false };
  } catch (e) {
    console.error("owner auto reply skipped", e instanceof Error ? e.message : e);
    return skip(e instanceof Error ? e.message : "owner auto reply failed");
  }
}
