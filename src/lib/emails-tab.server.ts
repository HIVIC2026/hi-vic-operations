// Office Emails tab (Jo 27 Oct 2026, decision 414) — server side. Callers have checked requireAdmin.
// - loadEmailsTab: open owner emails with a job (decision 245/386 change requests) and emails with no job (247
//   unmatched), each with its open AI draft, what they wrote, and whether the automatic website reply already went.
// - writeMissingEmailDrafts: asks the AI for up to DRAFTS_PER_LOAD missing drafts (job replies through the existing
//   writeAiReplyDraft; no-job replies tailored from Jo's approved wording, decision 413). Never sends.
// - sendJobEmailReply / sendNoJobEmailReply: the office pressed Send. Job replies go through sendAiDraft (saved on the
//   job's email history) and the email then leaves the tab; no-job replies go through the live owner email sender
//   behind the customer messages switch and the recipient boundary, then the email leaves the tab.
// - matchEmailToJob: files the email on the job (existing 247 match), then it becomes a "Has a job" email with a fresh
//   AI draft from that job's details.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError } from "./workflow.server";
import { AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT, aiReplyEmailHtml, aiReplyText, replySubject } from "./ai-email-reply.core";
import { EMAIL_CHANGE_REQUEST_EVENT } from "./email-intent.core";
import { EMAIL_UNMATCHED_DISMISSED_EVENT, EMAIL_UNMATCHED_EVENT, EMAIL_UNMATCHED_MATCHED_EVENT } from "./outlook-guess.core";
import { NEW_SENDER_REPLIED_EVENT, NEW_SENDER_REPLY_TEMPLATE, newSenderReplyKey } from "./new-sender-reply.core";
import {
  NO_JOB_DRAFT_CLOSED_EVENT, chunks, jobDraftKey, NO_JOB_DRAFT_EVENT, NO_JOB_INSTRUCTIONS, NO_JOB_REPLIED_REASON, NO_JOB_REPLY_PURPOSE, NO_JOB_REPLY_SENT_EVENT, buildEmailsTab, buildNoJobInput, finishNoJobReply,
  missingDrafts, noJobDraftKey, noJobReplyProblems, type DraftRef,
  buildNoJobFollowUpInput, finishNoJobFollowUp, followUpRetryDue, NO_JOB_DRAFT_FAILED_EVENT, NO_JOB_FOLLOWUP_INSTRUCTIONS, noJobFollowUpKey, noJobFollowUpProblems, noJobFollowUpSentKey, type EmailsTab, type JobEmailRow, type UnmatchedRow,
} from "./emails-tab.core";

const loose = admin as unknown as SupabaseClient;
type Det = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function loadEmailsTab(): Promise<EmailsTab> {
  const { openEmailItems } = await import("./email-office.server");
  const items = await openEmailItems(400);
  const changes: JobEmailRow[] = items.changes.filter((c) => !!c.jobId).map((c) => {
    const d = c as unknown as Det;
    return { eventId: c.eventId, jobId: c.jobId as string, jobNumber: c.jobNumber, at: c.at, intent: str(d["intent"]), messageId: str(d["message_id"]), from: str(d["from"]), subject: str(d["subject"]) ?? str(d["phrase"]), label: str(d["label"]), threadId: str(d["thread_id"]), receivedAt: str(d["received_at"]) };
  });
  const unmatched: UnmatchedRow[] = items.unmatched.map((u) => {
    const d = u as unknown as Det;
    const guesses = Array.isArray(d["guesses"]) ? (d["guesses"] as { job_id?: string; job_number?: string | null }[]).filter((g) => !!g.job_id).map((g) => ({ job_id: g.job_id as string, job_number: g.job_number ?? null })) : [];
    return { eventId: u.eventId, at: u.at, messageId: str(d["message_id"]), from: str(d["from"]), fromName: str(d["from_name"]), subject: str(d["subject"]), snippet: str(d["snippet"]), guesses, threadId: str(d["thread_id"]), receivedAt: str(d["received_at"]) };
  });
  const ids = [...new Set([...changes, ...unmatched].map((r) => r.messageId).filter((x): x is string => !!x))];
  const jobIds = [...new Set(changes.map((c) => c.jobId))];
  const senders = [...new Set(unmatched.map((u) => (u.from ?? "").trim().toLowerCase()).filter(Boolean))];
  // Review fix 7: every `.in(...)` list is split so the request URL stays short.
  const many = async <T,>(xs: string[], q: (part: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunks(xs)) { const r = await q(part); if (r.error) throw new Error(`Emails unavailable: ${r.error.message}`); out.push(...((r.data ?? []) as T[])); }
    return out;
  };
  const [drafts, inbound, owners, replied, deliveries, manualReplies] = await Promise.all([
    many<{ id: string; job_id: string | null; event_type: string; details: Det }>(ids, (part) => loose.from("workflow_events").select("id, job_id, event_type, details").in("event_type", [AI_EMAIL_DRAFT_EVENT, NO_JOB_DRAFT_EVENT]).in("details->>message_id", part).order("created_at", { ascending: false })),
    many<{ provider_message_id: string | null; body: string | null }>(ids, (part) => admin.from("job_communications").select("provider_message_id, body").eq("channel", "email").eq("direction", "inbound").in("provider_message_id", part)),
    many<{ id: string; stage: string; deleted_at: string | null; owners: { full_name: string | null } | null }>(jobIds, (part) => admin.from("jobs").select("id, stage, deleted_at, owners(full_name)").in("id", part)),
    many<{ details: { from?: string; mode?: string } | null }>(senders, (part) => loose.from("workflow_events").select("details").eq("event_type", NEW_SENDER_REPLIED_EVENT).in("details->>from", part)),
    many<{ details: { message_id?: string; outcome?: string; mode?: string } | null }>(ids, (part) => loose.from("admin_config_events").select("details").eq("event_type", "new_sender_reply_delivery").in("details->>message_id", part)),
    many<{ details: { unmatched_event_id?: string; status?: string } | null }>(unmatched.map((u) => u.eventId), (part) => loose.from("workflow_events").select("details").eq("event_type", NO_JOB_REPLY_SENT_EVENT).in("details->>unmatched_event_id", part)),
  ]);
  // Review fix 6: resolutions are looked up for exactly these drafts, not the newest N across all jobs.
  const done = await many<{ details: { draft_event_id?: string } | null }>(drafts.map((d) => d.id), (part) => loose.from("workflow_events").select("details").in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT, NO_JOB_REPLY_SENT_EVENT, NO_JOB_DRAFT_CLOSED_EVENT]).in("details->>draft_event_id", part));
  const closed = new Set(done.map((r) => r.details?.draft_event_id).filter(Boolean));
  const edits = await (await import("./ai-email-reply.server")).draftEditsFor(drafts.map((d) => d.id));
  // Review fix 1: job drafts by job + message, no-job drafts by message — never mixed.
  const jobDrafts = new Map<string, DraftRef>(), noJobDrafts = new Map<string, DraftRef>(), closedJobDrafts = new Set<string>();
  for (const r of drafts) {
    const mid = str(r.details["message_id"]);
    if (!mid) continue;
    const ref: DraftRef = { eventId: r.id, body: edits.get(r.id) ?? String(r.details["body"] ?? ""),
      kind: r.details["kind"] === "follow_up" ? "follow_up" : "link", nothingToAnswer: r.details["nothing_to_answer"] === true };
    if (r.event_type === AI_EMAIL_DRAFT_EVENT && r.job_id) {
      const k = jobDraftKey(r.job_id, mid);
      if (closed.has(r.id)) closedJobDrafts.add(k); else if (!jobDrafts.has(k)) jobDrafts.set(k, ref);
    } else if (r.event_type === NO_JOB_DRAFT_EVENT && !closed.has(r.id) && !noJobDrafts.has(mid)) noJobDrafts.set(mid, ref);
  }
  for (const k of jobDrafts.keys()) closedJobDrafts.delete(k);
  const inboundByMessage = new Map<string, string>();
  for (const r of inbound) if (r.provider_message_id && r.body) inboundByMessage.set(r.provider_message_id, r.body.slice(0, 1500));
  const ownerNameByJob = new Map<string, string | null>();
  for (const r of owners) ownerNameByJob.set(r.id, r.owners?.full_name ?? null);
  const autoRepliedSenders = new Set(replied.filter((r) => r.details?.mode !== "test").map((r) => (r.details?.from ?? "").toLowerCase()));
  const answeredNoJobMessageIds = new Set(deliveries.filter((r) => r.details?.mode !== "test" && r.details?.outcome === "accepted").map((r) => r.details?.message_id).filter((id): id is string => !!id));
  const manuallyAnswered = new Set(manualReplies.filter((r) => r.details?.status === "sent").map((r) => r.details?.unmatched_event_id));
  for (const u of unmatched) if (u.messageId && manuallyAnswered.has(u.eventId)) answeredNoJobMessageIds.add(u.messageId);
  const openJobIds = new Set(owners.filter((r) => !r.deleted_at && r.stage !== "cancelled" && r.stage !== "complete").map((r) => r.id));
  const threads = [...new Set([...changes, ...unmatched].map((r) => r.threadId).filter((t): t is string => !!t))];
  const outlookSent = await many<{ message: { threadId?: string; at?: string; to?: string[] } }>(threads, (part) => loose.from("outlook_message_work").select("message").eq("message->>direction", "outbound").in("message->>threadId", part));
  const outlookReplies = outlookSent.map((r) => ({ threadId: r.message?.threadId ?? null, at: r.message?.at ?? null, recipients: r.message?.to ?? [] }));
  return buildEmailsTab({ changes, unmatched, jobDrafts, noJobDrafts, closedJobDrafts, inboundByMessage, ownerNameByJob, autoRepliedSenders, answeredNoJobMessageIds, outlookReplies, openJobIds });
}

async function eventOf(id: string, type: string) {
  const { data, error } = await loose.from("workflow_events").select("id, job_id, details").eq("id", id).eq("event_type", type).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; job_id: string | null; details: Det } | null;
}

/** Job reply draft for an owner email that has none yet (e.g. arrived before AI drafts were switched on). */
async function draftForJobRequest(requestEventId: string): Promise<string> {
  const ev = await eventOf(requestEventId, EMAIL_CHANGE_REQUEST_EVENT);
  const mid = str(ev?.details["message_id"]);
  if (!ev?.job_id || !mid) return "skipped";
  const { data: row } = await admin.from("job_communications").select("body, subject, received_at, created_at").eq("job_id", ev.job_id).eq("provider_message_id", mid).eq("direction", "inbound").limit(1).maybeSingle();
  const m = {
    providerMessageId: mid, threadId: str(ev.details["thread_id"]), internetMessageId: str(ev.details["internet_message_id"]), direction: "inbound" as const,
    from: str(ev.details["from"]), fromName: null, to: [], cc: [], subject: row?.subject ?? str(ev.details["subject"]), body: row?.body ?? str(ev.details["phrase"]) ?? "",
    at: row?.received_at ?? row?.created_at ?? new Date().toISOString(), hasAttachments: false, attachments: [],
  };
  const { writeAiReplyDraft } = await import("./ai-email-reply.server");
  return writeAiReplyDraft({ jobId: ev.job_id, message: m, kind: "other", reason: "Emails tab: owner email waiting for a reply" });
}

/** No-job reply draft: Jo's approved wording (decision 413) tailored by the AI to what they asked. One per message. */
async function draftForUnmatched(unmatchedEventId: string): Promise<string> {
  const ev = await eventOf(unmatchedEventId, EMAIL_UNMATCHED_EVENT);
  const mid = str(ev?.details["message_id"]);
  if (!ev || !mid) return "skipped";
  const fromName = str(ev.details["from_name"]);
  const subject = str(ev.details["subject"]);
  const sender = (str(ev.details["from"]) ?? "").trim().toLowerCase();
  // Jo 28 Oct 2026: someone who already got the website link gets an answer-only reply, never the link again.
  const { data: had } = sender ? await loose.from("workflow_events").select("details").eq("event_type", NEW_SENDER_REPLIED_EVENT).eq("details->>from", sender).limit(20) : { data: [] };
  const followUp = ((had ?? []) as { details: { mode?: string } | null }[]).some((r) => r.details?.mode !== "test");
  const { data: dup } = await loose.from("workflow_events").select("id, details").eq("event_type", NO_JOB_DRAFT_EVENT).eq("details->>message_id", mid).limit(5);
  if (((dup ?? []) as { details: Det | null }[]).some((d) => (d.details?.["kind"] === "follow_up") === followUp)) return "already";
  if (followUp) return draftFollowUp(ev, mid, fromName, subject);
  let body: string;
  try {
    const { aiText } = await import("./ai-email-reply.server");
    body = finishNoJobReply(await aiText(buildNoJobInput({ fromName, subject, snippet: str(ev.details["snippet"]) ?? "" }), NO_JOB_INSTRUCTIONS), fromName);
  } catch (e) {
    console.error("No-job AI draft fell back to the base wording", e instanceof Error ? e.message : e);
    body = finishNoJobReply("", fromName);
  }
  const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: null, event_type: NO_JOB_DRAFT_EVENT, internal: true,
    summary: `AI reply draft (homeowner page) waiting for the office — ${str(ev.details["from"]) ?? "unknown sender"}`,
    details: { message_id: mid, unmatched_event_id: ev.id, from: str(ev.details["from"]), from_name: fromName, their_subject: subject, subject: replySubject(subject), body, idempotency_key: noJobDraftKey(mid) } });
  if (error) throw new Error(error.message);
  return "drafted";
}

/** Answer-only draft for a follow-up from someone who already has the website link. No AI = no draft (tried again next load). */
async function draftFollowUp(ev: { id: string; details: Det }, mid: string, fromName: string | null, subject: string | null): Promise<string> {
  // Review fix 6: a failed AI attempt is tried again after 30 minutes, not on every page load.
  const { data: fails } = await loose.from("workflow_events").select("created_at").eq("event_type", NO_JOB_DRAFT_FAILED_EVENT).eq("details->>message_id", mid).order("created_at", { ascending: false }).limit(3);
  if (!followUpRetryDue(((fails ?? []) as { created_at: string }[]).map((f) => f.created_at), Date.now())) return "waiting";
  let body: string | null;
  try {
    const { aiText } = await import("./ai-email-reply.server");
    body = finishNoJobFollowUp(await aiText(buildNoJobFollowUpInput({ fromName, subject, snippet: str(ev.details["snippet"]) ?? "" }), NO_JOB_FOLLOWUP_INSTRUCTIONS));
  } catch (e) {
    const why = e instanceof Error ? e.message : "AI error";
    await loose.from("workflow_events").insert({ job_id: null, actor_id: null, event_type: NO_JOB_DRAFT_FAILED_EVENT, internal: true,
      summary: `AI couldn't write a follow-up reply yet — ${str(ev.details["from"]) ?? "unknown sender"}`, details: { message_id: mid, unmatched_event_id: ev.id, error: why.slice(0, 300) } })
      .then(({ error }) => { if (error) console.error("follow-up failure not recorded", error.message); });
    throw e;
  }
  const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: null, event_type: NO_JOB_DRAFT_EVENT, internal: true,
    summary: body ? `AI reply draft (answers their question) waiting for the office — ${str(ev.details["from"]) ?? "unknown sender"}` : `Nothing to answer — ${str(ev.details["from"]) ?? "unknown sender"}`,
    details: { kind: "follow_up", nothing_to_answer: !body, message_id: mid, unmatched_event_id: ev.id, from: str(ev.details["from"]), from_name: fromName, their_subject: subject, subject: replySubject(subject), body: body ?? "", idempotency_key: `${noJobDraftKey(mid)}:follow_up` } });
  if (error) throw new Error(error.message);
  return "drafted";
}

export async function writeMissingEmailDrafts(): Promise<{ drafted: number }> {
  const want = missingDrafts(await loadEmailsTab());
  let drafted = 0;
  for (const id of want.jobRequests) if ((await draftForJobRequest(id).catch(() => "skipped")) === "drafted") drafted++;
  for (const id of want.unmatched) if ((await draftForUnmatched(id).catch((e) => { console.error("no-job draft skipped", e); return "skipped"; })) === "drafted") drafted++;
  return { drafted };
}

/** Send the job reply (saved on the job's email history), then clear a reply-needed email from the tab. */
export async function sendJobEmailReply(requestEventId: string, draftEventId: string, body: string, actorId: string) {
  const req = await eventOf(requestEventId, EMAIL_CHANGE_REQUEST_EVENT);
  if (!req?.job_id) throw new WorkflowError("That email wasn't found.");
  const { sendAiDraft } = await import("./ai-email-reply.server");
  const r = await sendAiDraft(draftEventId, body, actorId);
  if (req.details["intent"] === "reply") await (await import("./email-office.server")).applyEmailChange(requestEventId, actorId).catch((e) => console.error("reply sent; row not cleared", e));
  return r;
}

/** Send the no-job reply to the sender, then the email leaves the tab (recorded as replied, left in Outlook). */
export async function sendNoJobEmailReply(unmatchedEventId: string, draftEventId: string, body: string, actorId: string, now = new Date()) {
  // Jo 27 Oct 2026: the office presses Send, so it goes whenever she chooses — no after-8pm hold on manual sends.
  void now;
  const ev = await eventOf(unmatchedEventId, EMAIL_UNMATCHED_EVENT);
  const draft = await eventOf(draftEventId, NO_JOB_DRAFT_EVENT);
  if (!ev || !draft || draft.details["unmatched_event_id"] !== ev.id) throw new WorkflowError("That email or its draft wasn't found.");
  if (draft.details["kind"] === "follow_up") return sendNoJobFollowUp(ev, draft, body, actorId);
  const problems = noJobReplyProblems(body);
  if (problems.length) throw new WorkflowError(problems.join(" "));
  const { data: res } = await loose.from("workflow_events").select("event_type").in("event_type", [EMAIL_UNMATCHED_MATCHED_EVENT, EMAIL_UNMATCHED_DISMISSED_EVENT]).eq("details->>unmatched_event_id", ev.id).limit(1);
  if ((res ?? []).length) throw new WorkflowError("That email has already been dealt with.");
  const to = (str(ev.details["from"]) ?? "").trim().toLowerCase();
  if (!to) throw new WorkflowError("That email has no sender address.");
  if (!(await (await import("./comms.server")).customerCommsEnabled())) throw new WorkflowError("Customer emails are switched off — turn them on in Settings to send.");
  const { testRecipientBoundary } = await import("./comms-test-recipient.core");
  const boundary = testRecipientBoundary(to, null);
  if (boundary.status === "blocked") throw new WorkflowError(boundary.reason);
  // Review fixes 4–5: one website reply per person, ever — the same claim the automatic new-sender reply uses (unique
  // index on its key), written BEFORE the send, so a double tap, a second email from them, or the automatic reply can
  // never send twice. A refused send keeps the claim (as the automatic reply does); the office replies from Outlook.
  const { error: claimErr } = await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: NEW_SENDER_REPLIED_EVENT, internal: true,
    summary: `Website reply (office, Emails tab) to ${to}`,
    details: { mode: "live", from: to, template: `${NEW_SENDER_REPLY_TEMPLATE}-office`, message_id: str(ev.details["message_id"]), draft_event_id: draft.id, idempotency_key: newSenderReplyKey(to) } });
  if (claimErr?.code === "23505") throw new WorkflowError("This person has already had a reply with the website link.");
  if (claimErr) throw new WorkflowError(`Not sent — couldn't record the reply first (${claimErr.message}).`);
  const subject = String(draft.details["subject"] ?? replySubject(str(ev.details["subject"])));
  const key = `${noJobDraftKey(String(draft.details["message_id"]))}:send:${draft.id}`;
  const K = await import("./email-kit.core");
  const html = aiReplyEmailHtml(body, { subject, unsubscribe: null });
  const text = K.plainText(aiReplyText(body), { unsubscribe: null });
  const { resendSend } = await import("./hot-leads-send.server");
  const d = await resendSend(to, subject, html, text, key, null).catch((e: unknown) => ({ outcome: "uncertain" as const, detail: e instanceof Error ? e.message : "send error" }));
  if (d.outcome === "rejected" || d.outcome === "not_attempted") throw new WorkflowError(`Not sent — ${d.detail}. Reply to them from Outlook instead.`);
  const status = d.outcome === "accepted" ? "sent" : `delivery uncertain: ${d.detail}`;
  const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: NO_JOB_REPLY_SENT_EVENT, internal: true,
    summary: `Reply sent to ${to} pointing to the homeowner page (office approved)`, details: { draft_event_id: draft.id, unmatched_event_id: ev.id, to, subject, body: body.trim(), status, purpose: NO_JOB_REPLY_PURPOSE, idempotency_key: key } });
  if (error) console.error("no-job reply sent but not recorded", error.message);
  await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: EMAIL_UNMATCHED_DISMISSED_EVENT, internal: true,
    summary: `Email from ${to} answered with the homeowner page link — left in Outlook`, details: { unmatched_event_id: ev.id, message_id: str(ev.details["message_id"]), reason: NO_JOB_REPLIED_REASON } })
    .then(({ error: e }) => { if (e) console.error("no-job reply sent; row not cleared", e.message); });
  await (await import("./outlook-sync.server")).archiveOutlookMessage(str(ev.details["message_id"]), null, actorId);
  return { status };
}

/** Follow-up reply (Jo 28 Oct 2026): answers their question only. Not the one-link-per-person claim — they already had
 *  the link — but once per email: refused if already sent, and the email service's once-only key is per email. */
async function sendNoJobFollowUp(ev: { id: string; details: Det }, draft: { id: string; details: Det }, body: string, actorId: string) {
  if (draft.details["nothing_to_answer"] === true) throw new WorkflowError("Nothing to answer on this email.");
  const problems = noJobFollowUpProblems(body);
  if (problems.length) throw new WorkflowError(problems.join(" "));
  const { data: res } = await loose.from("workflow_events").select("event_type").in("event_type", [EMAIL_UNMATCHED_MATCHED_EVENT, EMAIL_UNMATCHED_DISMISSED_EVENT]).eq("details->>unmatched_event_id", ev.id).limit(1);
  if ((res ?? []).length) throw new WorkflowError("That email has already been dealt with.");
  const mid = str(ev.details["message_id"]);
  if (!mid) throw new WorkflowError("That email has no message id.");
  const sentKey = noJobFollowUpSentKey(mid);
  const key = noJobFollowUpKey(mid, body);
  const { data: sent } = await loose.from("workflow_events").select("id").eq("event_type", NO_JOB_REPLY_SENT_EVENT).eq("details->>sent_key", sentKey).limit(1);
  if ((sent ?? []).length) throw new WorkflowError("A reply to this email has already been sent.");
  const to = (str(ev.details["from"]) ?? "").trim().toLowerCase();
  if (!to) throw new WorkflowError("That email has no sender address.");
  if (!(await (await import("./comms.server")).customerCommsEnabled())) throw new WorkflowError("Customer emails are switched off — turn them on in Settings to send.");
  const { testRecipientBoundary } = await import("./comms-test-recipient.core");
  const boundary = testRecipientBoundary(to, null);
  if (boundary.status === "blocked") throw new WorkflowError(boundary.reason);
  const subject = String(draft.details["subject"] ?? replySubject(str(ev.details["subject"])));
  const K = await import("./email-kit.core");
  const html = aiReplyEmailHtml(body, { subject, unsubscribe: null });
  const text = K.plainText(aiReplyText(body), { unsubscribe: null });
  const { resendSend } = await import("./hot-leads-send.server");
  const d = await resendSend(to, subject, html, text, key, null).catch((e: unknown) => ({ outcome: "uncertain" as const, detail: e instanceof Error ? e.message : "send error" }));
  if (d.outcome === "rejected" || d.outcome === "not_attempted") throw new WorkflowError(`Not sent — ${d.detail}. Reply to them from Outlook instead.`);
  const status = d.outcome === "accepted" ? "sent" : `delivery uncertain: ${d.detail}`;
  const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: NO_JOB_REPLY_SENT_EVENT, internal: true,
    summary: `Reply sent to ${to} answering their question (office approved)`, details: { draft_event_id: draft.id, unmatched_event_id: ev.id, to, subject, body: body.trim(), status, purpose: NO_JOB_REPLY_PURPOSE, kind: "follow_up", sent_key: sentKey, idempotency_key: key } });
  if (error) console.error("follow-up reply sent but not recorded", error.message);
  await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: EMAIL_UNMATCHED_DISMISSED_EVENT, internal: true,
    summary: `Email from ${to} answered (follow-up) — left in Outlook`, details: { unmatched_event_id: ev.id, message_id: mid, reason: NO_JOB_REPLIED_REASON } })
    .then(({ error: e }) => { if (e) console.error("follow-up reply sent; row not cleared", e.message); });
  await (await import("./outlook-sync.server")).archiveOutlookMessage(mid, null, actorId);
  return { status };
}

/** Match a no-job email to a job: filed on the job, then it is a "Has a job" email with a fresh AI draft from that job. */
export async function matchEmailToJob(unmatchedEventId: string, jobId: string, actorId: string) {
  const ev = await eventOf(unmatchedEventId, EMAIL_UNMATCHED_EVENT);
  const { matchOutlookEmail } = await import("./email-office.server");
  const r = await matchOutlookEmail(unmatchedEventId, jobId, actorId);
  const mid = str(ev?.details["message_id"]);
  if (ev && mid) {
    // Review fix 1: the homeowner-page draft is no longer used once the email is on a job.
    const { data: nj } = await loose.from("workflow_events").select("id").eq("event_type", NO_JOB_DRAFT_EVENT).eq("details->>message_id", mid).limit(5);
    for (const d of (nj ?? []) as { id: string }[])
      await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: NO_JOB_DRAFT_CLOSED_EVENT, internal: true, summary: "Homeowner-page draft closed: email matched to a job", details: { draft_event_id: d.id, job_id: jobId } })
        .then(({ error }) => { if (error) console.error("no-job draft not closed", error.message); });
    // Review fix 2: only the job's OWNER gets a reply row (a reply goes to the owner's address). Anyone else's email
    // (a manager, family) is just filed on the job, as the normal email sync does.
    const { data: job } = await admin.from("jobs").select("owners(email)").eq("id", jobId).maybeSingle();
    const ownerEmail = ((job as { owners?: { email?: string | null } | null } | null)?.owners?.email ?? "").trim().toLowerCase();
    const fromOwner = !!ownerEmail && (str(ev.details["from"]) ?? "").trim().toLowerCase() === ownerEmail;
    const { data: open } = fromOwner ? await loose.from("workflow_events").select("id").eq("event_type", EMAIL_CHANGE_REQUEST_EVENT).eq("job_id", jobId).eq("details->>message_id", mid).limit(1) : { data: [1] };
    if (fromOwner && !(open ?? []).length) {
      const subject = str(ev.details["subject"]);
      const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: EMAIL_CHANGE_REQUEST_EVENT, internal: true,
        summary: "Owner emailed — reply needed (matched on the Emails tab)",
        details: { decision: 414, intent: "reply", label: "Owner emailed — reply needed", message_id: mid, thread_id: str(ev.details["thread_id"]), internet_message_id: str(ev.details["internet_message_id"]),
          from: str(ev.details["from"]), subject, phrase: subject, received_at: str(ev.details["received_at"]), reason: "matched from the Emails tab" } });
      if (error) console.error("matched email not added to Has a job", error.message);
    }
    return { ...r, fromOwner };
  }
  return r;
}
