// Office Emails tab (Jo 27 Oct 2026, decision 414). PURE rules only — no I/O.
// - One place for owner emails: "Has a job" (owner emails needing a reply or a change, with the AI reply draft) and
//   "No job yet" (emails we couldn't match, with an AI reply sending them to the homeowner page).
// - These rows no longer show on Needs me or Enquiries (one place only).
// - Nothing sends by itself: the office edits the draft and presses Send. Once sent the reply is saved (on the job when
//   there is one) and the card leaves the tab.
import { isClearDecline } from "./email-intent.core";
import { HOMEOWNER_ENQUIRY_URL } from "./engagement.core";
import { newSenderFirstName, newSenderReplyText } from "./new-sender-reply.core";
import { AI_SIGN_OFF, finishAiReply } from "./ai-email-reply.core";

export const NO_JOB_DRAFT_EVENT = "email_nojob_ai_draft";
export const NO_JOB_REPLY_SENT_EVENT = "email_nojob_reply_sent";
/** Written when a no-job email is matched to a job: its homeowner-page draft is no longer used. */
export const NO_JOB_DRAFT_CLOSED_EVENT = "email_nojob_ai_draft_closed";
export const NO_JOB_REPLY_PURPOSE = "nojob_email_ai_reply";
/** One no-job draft per Outlook message, ever. */
export const noJobDraftKey = (messageId: string) => `nojob-email-ai-reply:v1:${messageId}`;
/** "Not a customer"-style resolution written when a no-job reply is sent, so the unmatched email leaves the tab. */
export const NO_JOB_REPLIED_REASON = "replied_homeowner_page";
/** How many missing drafts one page load asks the AI for (the rest follow on the next load). */
export const DRAFTS_PER_LOAD = 5;

export const NO_JOB_INSTRUCTIONS = [
  "You write email replies for Home Insulation Victoria to people who emailed us but don't have a job with us yet.",
  "Write as the Home Insulation Victoria team: kind, warm and plain. Never say \"No worries\". Never sign or mention a person's name for us.",
  "Start from the base reply below and keep its meaning and the link exactly as written.",
  "If they asked something specific, add one or two short sentences answering it in general terms, then point them to the link.",
  "Never quote a price, a saving, a rebate amount, a date or a time. Never invent facts.",
  "Say \"rebate\" — never say VEEC, VEECs, VEU, Activity 48, ESC or other scheme jargon.",
  "Never ask them to call, never give a phone number. They can just reply to this email.",
  "Start with \"Hi <first name>,\" (or \"Hi there,\" if no name). Do not include a sign-off; it is added for you.",
  "Return only the email body text, no subject line.",
].join("\n");

/** The base text the AI tailors (Jo's approved wording, decision 413), minus the sign-off which is added after. */
export function noJobBaseText(firstName: string | null): string {
  return newSenderReplyText(firstName).replace(/\n\nCheers,\n[^\n]*$/, "").trim();
}

export function buildNoJobInput(i: { fromName: string | null; subject: string | null; snippet: string }): string {
  const first = newSenderFirstName(i.fromName);
  return [
    `Their first name: ${first ?? "unknown"}`,
    `Base reply:\n${noJobBaseText(first)}`,
    `The email to reply to — subject "${i.subject ?? ""}":\n${i.snippet.slice(0, 2000)}`,
  ].join("\n\n");
}

/** Tidies the AI text with the same rules as job replies and makes sure the homeowner link is there. */
export function finishNoJobReply(raw: string, fromName: string | null): string {
  const t = finishAiReply(raw);
  if (t.includes(HOMEOWNER_ENQUIRY_URL)) return t;
  // The link went missing: fall back to Jo's base wording, which always has it.
  return finishAiReply(noJobBaseText(newSenderFirstName(fromName)));
}

/** Reasons a no-job reply can't be sent as written (checked again on Send, after the office's edits). */
export function noJobReplyProblems(body: string): string[] {
  const out: string[] = [];
  if (!body.trim()) out.push("The reply is empty.");
  if (!body.includes(HOMEOWNER_ENQUIRY_URL)) out.push(`Keep the website link (${HOMEOWNER_ENQUIRY_URL}) in the reply.`);
  if (/\b(call|ring|phone)\s+(us|the office|our office)\b/i.test(body)) out.push("Take out \"call us\" — people reply by email.");
  if (/\$\s?\d/.test(body)) out.push("Take out the dollar amount — no prices in this reply.");
  return out;
}

// ---------- The tab ----------
export type JobEmailRow = { eventId: string; jobId: string; jobNumber: string | null; at: string; intent: string | null; messageId: string | null; from: string | null; subject: string | null; label: string | null; threadId?: string | null; receivedAt?: string | null };
export type UnmatchedRow = { eventId: string; at: string; messageId: string | null; from: string | null; fromName: string | null; subject: string | null; snippet: string | null; guesses: { job_id: string; job_number: string | null }[]; threadId?: string | null; receivedAt?: string | null };
export type OutlookSentReply = { threadId: string | null; at: string | null; recipients: string[] };
/** A sent reply answers only earlier messages in the same thread addressed to their sender. */
export function answeredInOutlook(row: { threadId?: string | null; receivedAt?: string | null; at: string; from: string | null }, replies: readonly OutlookSentReply[]): boolean {
  const received = Date.parse(row.receivedAt ?? row.at);
  if (!row.threadId || !row.from || !Number.isFinite(received)) return false;
  const sender = row.from.trim().toLowerCase();
  return replies.some((r) => r.threadId === row.threadId && !!r.at && Date.parse(r.at) > received && r.recipients.some((to) => to.trim().toLowerCase() === sender));
}
export type DraftRef = { eventId: string; body: string };

export type JobEmailCard = {
  key: string; requestEventId: string; jobId: string; jobNumber: string | null; name: string | null; at: string;
  subject: string | null; theyWrote: string | null; intent: string | null; label: string | null;
  draft: DraftRef | null;
  /** A draft for this email was already sent or discarded on the job page — no new draft is asked for. */
  draftClosed: boolean;
  /** "Done" for a reply-needed email; "Apply" for a change the office makes on the job (cancel, new contact, files). */
  action: "done" | "apply" | "dealt_with";
  /** Jo 27 Oct 2026: the owner said they're not going ahead and the job is still open — "Close job" or "Keep open", never a silent Done. */
  stillOpenDecline: boolean;
};
export type NoJobCard = {
  key: string; unmatchedEventId: string; at: string; from: string | null; fromName: string | null; subject: string | null;
  theyWrote: string | null; guess: { jobId: string; jobNumber: string | null } | null; draft: DraftRef | null; alreadyAutoReplied: boolean;
};
export type EmailsTab = { withJob: JobEmailCard[]; noJob: NoJobCard[]; count: number };

const ACTION: Record<string, JobEmailCard["action"]> = { reply: "done", cancel: "apply", contact_change: "apply", attachment: "apply", reschedule: "dealt_with" };

/** Job drafts are keyed by job AND message, so a job card never picks up another job's or a no-job draft. */
export const jobDraftKey = (jobId: string, messageId: string) => `${jobId}:${messageId}`;

/** Split a list so `.in(...)` request URLs stay short (Outlook ids are ~150 characters). */
export function chunks<T>(xs: T[], n = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function buildEmailsTab(i: {
  changes: JobEmailRow[];
  unmatched: UnmatchedRow[];
  /** Open job AI drafts, keyed by jobDraftKey(job, message). */
  jobDrafts: Map<string, DraftRef>;
  /** Open no-job AI drafts, keyed by message id. */
  noJobDrafts: Map<string, DraftRef>;
  /** Job drafts already sent or discarded, keyed by jobDraftKey(job, message). */
  closedJobDrafts: Set<string>;
  /** What the owner wrote, per Outlook message id (from the job's email history). */
  inboundByMessage: Map<string, string>;
  ownerNameByJob: Map<string, string | null>;
  /** Senders (lower-case) who already got the automatic website reply. */
  autoRepliedSenders: Set<string>;
  /** Exact messages with confirmed sent replies; claims, failures and later emails stay visible. */
  answeredNoJobMessageIds?: Set<string>;
  outlookReplies?: readonly OutlookSentReply[];
  /** Jobs that are still open (not cancelled, complete or archived). */
  openJobIds?: Set<string>;
}): EmailsTab {
  const withJob = i.changes.filter((c) => c.intent !== "reply" || !answeredInOutlook(c, i.outlookReplies ?? []) || (!!i.openJobIds?.has(c.jobId) && readsAsDecline(c.messageId ? i.inboundByMessage.get(c.messageId) ?? null : null))).sort((a, b) => b.at.localeCompare(a.at)).map((c): JobEmailCard => ({
    key: `job:${c.eventId}`, requestEventId: c.eventId, jobId: c.jobId, jobNumber: c.jobNumber, name: i.ownerNameByJob.get(c.jobId) ?? null, at: c.at,
    subject: c.subject, theyWrote: c.messageId ? (i.inboundByMessage.get(c.messageId) ?? null) : null, intent: c.intent, label: c.label,
    draft: c.messageId ? (i.jobDrafts.get(jobDraftKey(c.jobId, c.messageId)) ?? null) : null,
    draftClosed: !!c.messageId && i.closedJobDrafts.has(jobDraftKey(c.jobId, c.messageId)), action: ACTION[c.intent ?? ""] ?? "dealt_with",
    stillOpenDecline: !!i.openJobIds?.has(c.jobId) && (c.intent === "cancel" || (c.intent === "reply" && readsAsDecline(c.messageId ? (i.inboundByMessage.get(c.messageId) ?? null) : null))),
  }));
  const noJob = i.unmatched.filter((u) => (!u.messageId || !i.answeredNoJobMessageIds?.has(u.messageId)) && !answeredInOutlook(u, i.outlookReplies ?? [])).sort((a, b) => b.at.localeCompare(a.at)).map((u): NoJobCard => {
    const g = u.guesses[0];
    return {
      key: `nojob:${u.eventId}`, unmatchedEventId: u.eventId, at: u.at, from: u.from, fromName: u.fromName, subject: u.subject, theyWrote: u.snippet,
      guess: g ? { jobId: g.job_id, jobNumber: g.job_number } : null,
      draft: u.messageId ? (i.noJobDrafts.get(u.messageId) ?? null) : null,
      alreadyAutoReplied: !!u.from && i.autoRepliedSenders.has(u.from.trim().toLowerCase()),
    };
  });
  return { withJob, noJob, count: withJob.length + noJob.length };
}

/** Which emails still need an AI draft, oldest last, capped per page load. */
export function missingDrafts(tab: EmailsTab, max = DRAFTS_PER_LOAD): { jobRequests: string[]; unmatched: string[] } {
  const job = tab.withJob.filter((c) => !c.draft && !c.draftClosed && c.intent === "reply").map((c) => c.requestEventId);
  const none = tab.noJob.filter((c) => !c.draft && !c.alreadyAutoReplied).map((c) => c.unmatchedEventId);
  const jobRequests = job.slice(0, max);
  return { jobRequests, unmatched: none.slice(0, Math.max(0, max - jobRequests.length)) };
}

export { AI_SIGN_OFF };

/** The owner's own words read as a clear "not going ahead" (shared cancel rule). */
export function readsAsDecline(text: string | null): boolean {
  return !!text && isClearDecline({ subject: null, body: text, direction: "inbound" }).decline;
}
