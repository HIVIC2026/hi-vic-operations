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

// ---------- Follow-up questions (Jo 28 Oct 2026) ----------
// Someone who already got the website link writes back with a question: the reply answers ONLY what they asked —
// no link again (Jo: "Answer only"), no prices, dates or times. Just "thanks"/"no" gets no reply ("Nothing to answer").
export const NOTHING_TO_ANSWER = "NOTHING_TO_ANSWER";
/** One sent follow-up per email, ever (checked before sending). */
export const noJobFollowUpSentKey = (messageId: string) => `nojob-email-followup:v1:${messageId}`;
/** Only a recorded idempotency_key (same email + same words → same key; edited words → new key). It does not stop a
 *  double send: the once-only guarantee is the follow-up claim below. */
export const noJobFollowUpKey = (messageId: string, body: string) => `${noJobFollowUpSentKey(messageId)}:${shortHash(body.trim())}`;
/** Once-only claim written BEFORE a follow-up goes through Outlook (unique on details->>'claim_key',
 *  docs/pending-migrations/followup-send-claim.sql): key `${noJobFollowUpSentKey(mid)}:try<n>`, n = earlier definite failures. */
export const NO_JOB_FOLLOWUP_CLAIM_EVENT = "email_nojob_followup_claim";
/** A follow-up Outlook definitely refused (job-less); each one allows one more try. */
export const NO_JOB_FOLLOWUP_FAILED_EVENT = "email_nojob_followup_failed";
/** Short fingerprint of a reply's words, for once-only send keys. */
export function shortHash(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
/** Written when the AI couldn't write a follow-up draft; that email is tried again after 30 minutes, not every page load. */
export const NO_JOB_DRAFT_FAILED_EVENT = "email_nojob_ai_draft_failed";
export const FOLLOWUP_RETRY_MS = 30 * 60 * 1000;
export function followUpRetryDue(failedAts: readonly string[], now: number): boolean {
  return !failedAts.some((at) => now - Date.parse(at) < FOLLOWUP_RETRY_MS);
}

export const NO_JOB_FOLLOWUP_INSTRUCTIONS = [
  "You write email replies for Home Insulation Victoria to people who don't have a job with us yet. We already sent them our website link, and they have written back.",
  "Write as the Home Insulation Victoria team: kind, warm and plain. Never say \"No worries\". Never sign or mention a person's name for us.",
  "Answer only what they asked, in one to three short sentences. Do not add anything else. Do not include any website link.",
  "Never quote a price, a saving, a rebate amount, a date or a time. Never invent facts. If you don't know, say we'll be in touch as soon as we can.",
  "Say \"rebate\" — never say VEEC, VEECs, VEU, Activity 48, ESC or other scheme jargon.",
  "Never ask them to call, never give a phone number. They can just reply to this email.",
  `If they only said thanks, ok, or that they're not interested — nothing to answer — return exactly ${NOTHING_TO_ANSWER} and nothing else.`,
  "Start with \"Hi <first name>,\" (or \"Hi there,\" if no name). Do not include a sign-off; it is added for you.",
  "Return only the email body text, no subject line.",
].join("\n");

/** Per sender (lower-case): do they have the website link? Jo 28 Oct 2026: a link email that definitely failed doesn't
 *  count, so they can be sent it. Unclear or still-sending counts as had, so the link can never go twice. */
export type LinkState = { hasLink: boolean; failedOnly: boolean; failures: number };
export function linkStates(i: {
  claims: readonly string[];
  automatic: readonly { from?: string | null; outcome?: string | null }[];
  office: readonly { to?: string | null; status?: string | null; kind?: string | null }[];
}): Map<string, LinkState> {
  const n = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();
  const att = new Map<string, boolean[]>(); // true = definitely failed
  const add = (k: string, failed: boolean) => { if (k) att.set(k, [...(att.get(k) ?? []), failed]); };
  const claimed = new Set(i.claims.map(n).filter(Boolean));
  for (const r of i.automatic) if (r.outcome) add(n(r.from), r.outcome === "rejected" || r.outcome === "not_attempted");
  for (const r of i.office) if (r.kind !== "follow_up" && r.status) add(n(r.to), r.status.startsWith("failed"));
  const out = new Map<string, LinkState>();
  for (const k of new Set([...claimed, ...att.keys()])) {
    const a = att.get(k) ?? [];
    const failedOnly = a.length > 0 && a.every(Boolean);
    out.set(k, { hasLink: !failedOnly, failedOnly, failures: a.filter(Boolean).length });
  }
  return out;
}

/** Their new words only: cuts the quoted earlier email ("On 28 Oct 2026, at 6:35 pm, … <info@…" / "… wrote:").
 *  Capital "On" followed by a date number, so "on weekends" or a signature with an email address is never cut. */
export function stripQuotedEmail(text: string): string {
  const cut = text.search(/\s*(?:\bOn\s(?=[^<\n]{0,40}?\b\d{1,4}\b)[^<\n]{3,120}?(?:\bwrote:|<[^>\s]*@)|-{3,}\s*Original Message|\bFrom:\s[^\n]{0,160}?\bSent:)/);
  const t = cut >= 0 ? text.slice(0, cut) : text;
  return t.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

export function buildNoJobFollowUpInput(i: { fromName: string | null; subject: string | null; snippet: string }): string {
  const first = newSenderFirstName(i.fromName);
  return [
    `Their first name: ${first ?? "unknown"}`,
    `The email to reply to — subject "${i.subject ?? ""}":\n${stripQuotedEmail(i.snippet).slice(0, 2000)}`,
  ].join("\n\n");
}

/** Tidies the AI text like job replies; null only when the AI said exactly "nothing to answer". Empty = error (retried). */
export function finishNoJobFollowUp(raw: string): string | null {
  const t = raw.replace(/\r/g, "").trim();
  if (!t) throw new Error("The AI wrote nothing");
  if (t.replace(/[\s.!"'`]/g, "") === NOTHING_TO_ANSWER) return null;
  return finishAiReply(t);
}

/** Reasons a follow-up reply can't be sent as written (checked again on Send, after the office's edits). */
export function noJobFollowUpProblems(body: string): string[] {
  if (!body.trim()) return ["The reply is empty."];
  const out = noJobReplyProblems(`${body}\n${HOMEOWNER_ENQUIRY_URL}`);
  if (/homeinsulationvictoria\.com\.au/i.test(body)) out.push("Take out the website link — they already have it.");
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
/** kind: "link" = the website-link reply; "follow_up" = an answer to someone who already has the link (Jo 28 Oct 2026). */
export type DraftRef = { eventId: string; body: string; kind?: "link" | "follow_up"; nothingToAnswer?: boolean };

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
  /** They already got the website link: the reply answers only their question (Jo 28 Oct 2026). */
  followUp: boolean;
  /** Follow-up that just said thanks/no — no reply to send. */
  nothingToAnswer: boolean;
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
  /** Senders (lower-case) who have the website link (linkStates: anything but a definitely-failed link email). */
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
    const followUp = !!u.from && i.autoRepliedSenders.has(u.from.trim().toLowerCase());
    const found = u.messageId ? (i.noJobDrafts.get(u.messageId) ?? null) : null;
    // A follow-up only ever uses a follow-up draft (never the website-link one), and a first email never uses a follow-up draft.
    const draft = found && ((found.kind === "follow_up") === followUp) ? found : null;
    return {
      key: `nojob:${u.eventId}`, unmatchedEventId: u.eventId, at: u.at, from: u.from, fromName: u.fromName, subject: u.subject, theyWrote: u.snippet,
      guess: g ? { jobId: g.job_id, jobNumber: g.job_number } : null,
      draft, alreadyAutoReplied: followUp, followUp, nothingToAnswer: !!draft?.nothingToAnswer,
    };
  });
  return { withJob, noJob, count: withJob.length + noJob.length };
}

/** Which emails still need an AI draft, oldest last, capped per page load. */
export function missingDrafts(tab: EmailsTab, max = DRAFTS_PER_LOAD): { jobRequests: string[]; unmatched: string[] } {
  const job = tab.withJob.filter((c) => !c.draft && !c.draftClosed && c.intent === "reply").map((c) => c.requestEventId);
  const none = tab.noJob.filter((c) => !c.draft).map((c) => c.unmatchedEventId);
  const jobRequests = job.slice(0, max);
  return { jobRequests, unmatched: none.slice(0, Math.max(0, max - jobRequests.length)) };
}

export { AI_SIGN_OFF };

/** The owner's own words read as a clear "not going ahead" (shared cancel rule). */
export function readsAsDecline(text: string | null): boolean {
  return !!text && isClearDecline({ subject: null, body: text, direction: "inbound" }).decline;
}
