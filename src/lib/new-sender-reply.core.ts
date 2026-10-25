// Decision 292 (Jo 25 Oct 2026, replaces 255 for new senders): a NEW email sender the Outlook copier cannot match (no
// owner, partner, staff or job), whose mail is a genuine enquiry or a price / rebate / eligibility question, does NOT
// get an enquiry created or an owner link. The portal SENDS (never drafts) ONE email reply, ever, per sender address,
// pointing them to the public calculator on the website, where the three questions and Save my spot qualify them.
// PURE: the decision (who gets the reply), the send mode (held / test / live), the idempotency key and the approved
// wording live here; nothing reads, writes or sends. Persistence and sending live in new-sender-reply.server.ts (one
// job-less `email_new_sender_replied` workflow event per reply). Decision 247's job-less `email_unmatched` row is
// raised as before, so the office can still Match the email by hand.
// Imports only pure cores and the import-free reply switches, so the Outlook copier test harness can load it.
import { CUSTOMER_BASE } from "./engagement.core";
import { classifyEmailIntents, looksLikeNewEnquiry, recentEnoughForAction, type EmailIntent, type IntentHit } from "./email-intent.core";
import { isHumanOwnerEmail } from "./owner-email-presentation.core";
import { REPLY_TEST_ALLOWLIST } from "./outlook-reply-drafts.core";

/** Jo approved the route and the wording in decision 292 (25 Oct 2026). Real senders still also need
 *  `customer_comms_enabled` and TEST mode off. */
export const NEW_SENDER_REPLY_APPROVED: boolean = true;
/** TEST mode: only senders on the reply allow-list (REPLY_TEST_ALLOWLIST) get the reply, through test-send. Going live
 *  for real new senders = set this to false (with `customer_comms_enabled` on). */
export const NEW_SENDER_REPLY_TEST_ONLY: boolean = true;

/** The one job-less workflow event per reply (pending migration docs/pending-migrations/new-sender-reply-events.sql). */
export const NEW_SENDER_REPLIED_EVENT = "email_new_sender_replied";

export const NEW_SENDER_REPLY_TEMPLATE = "O70";
export const NEW_SENDER_REPLY_TEMPLATE_TITLE = "O70 – New sender: start on the calculator";
/** The public calculator (`/` on the customer host serves the current calculator): the ONLY link this reply carries. */
export const WEBSITE_CALCULATOR_URL = `${CUSTOMER_BASE}/`;
export const NEW_SENDER_REPLY_SIGN_OFF = "— Home Insulation Victoria";

/** "Re: {their subject}" (never "Re: Re: …"); no subject → "Re: Your email". */
export function newSenderReplySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Re: Your email";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** First name from the From display name, or null ("there"): one plain word, never an address or a company. */
export function newSenderFirstName(fromName: string | null | undefined): string | null {
  const raw = (fromName ?? "").trim();
  if (!raw || /@/.test(raw)) return null;
  // "Smith, Jane" → Jane
  const comma = raw.match(/^[^,]+,\s*(.+)$/);
  const w = ((comma ? comma[1] : raw) ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[a-z][a-z'-]{1,}$/i.test(w)) return null;
  if (/^(the|mr|mrs|ms|miss|dr|info|admin|office|sales|accounts|enquiries|team|contact|hello|support)$/i.test(w)) return null;
  return w[0]!.toUpperCase() + w.slice(1).toLowerCase();
}

/** The approved wording (decision 292), verbatim; {first name or "there"} and {link} filled. */
export function newSenderReplyParagraphs(firstName: string | null) {
  return {
    greeting: `Hi ${firstName ?? "there"},`,
    thanks: "Thanks for getting in touch with Home Insulation Victoria.",
    calculator: `The quickest way to see your price and the Victorian Energy Upgrades discount is our 1-minute calculator: ${WEBSITE_CALCULATOR_URL}.`,
    questions: "Answer three quick questions and you'll get your estimate straight away, and you can save your spot for a free Ready Check.",
    reply: "If you have a question the calculator doesn't answer, just reply to this email.",
    signOff: NEW_SENDER_REPLY_SIGN_OFF,
  } as const;
}

/** Plain-text body exactly as approved (greeting … sign-off). */
export function newSenderReplyText(firstName: string | null): string {
  const p = newSenderReplyParagraphs(firstName);
  return [p.greeting, "", `${p.thanks} ${p.calculator}`, "", p.questions, "", p.reply, "", p.signOff].join("\n");
}

export const normaliseSender = (raw: string | null | undefined) => (raw ?? "").trim().toLowerCase();
/** One reply per sender address EVER: the idempotency key (unique in the database for live replies, and the provider
 *  idempotency key on the send). */
export const newSenderReplyKey = (email: string) => `new-sender-reply:v1:${normaliseSender(email)}`;
/** TEST replies are keyed per message, so Jo can test again with a new email. */
export const newSenderTestReplyKey = (providerMessageId: string) => `new-sender-reply:v1:test:${providerMessageId}`;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Our own people: never "new senders" (the human filter also drops inbound mail from our domain). */
export const OUR_EMAIL_DOMAINS: readonly string[] = ["homeinsulationvictoria.com.au"];
export const isStaffDomain = (email: string) => OUR_EMAIL_DOMAINS.some((d) => normaliseSender(email).endsWith(`@${d}`));
/** Mail sent by a machine (bounces, mailing lists, notifications) that the human filter may not catch by address. */
const AUTOMATED_SENDER = /^(?:bounces?|mailer|daemon|list|lists|listserv|majordomo|do[-_.]?not[-_.]?reply|donotreply|noreply|no[-_.]reply|auto|automated|alerts?|notify|notifications?|news|newsletters?|marketing|promotions?|digest|updates?|billing|invoices?|receipts?)(?:[-_.+][^@]*)?@/i;
const BULK_BODY = /\b(?:you are receiving this (?:email|message) because|to stop receiving these|opt[- ]out|this (?:email|message) was sent (?:to|by)|privacy policy\s*\|)/i;

/** Enquiry-like, as the existing intent core reads it: a price / rebate / eligibility question, or a new-enquiry cue.
 *  Trade (installer / partner) mail never counts. */
export function enquiryLikeIntents(m: { subject: string | null; body: string; from: string | null; hits?: IntentHit[] | undefined }): EmailIntent[] | null {
  const hits = m.hits ?? classifyEmailIntents({ subject: m.subject, body: m.body, direction: "inbound", from: m.from, fromPartner: false });
  const intents = hits.map((h) => h.intent);
  if (intents.includes("trade")) return null;
  const asksPrice = intents.includes("question_price") || intents.includes("question_rebate");
  const asksEligibility = /\b(eligib\w*|qualif(?:y|ies|ied)|am i (?:able|entitled))\b/i.test(`${m.subject ?? ""}\n${m.body}`);
  if (!asksPrice && !asksEligibility && !looksLikeNewEnquiry(m.subject, m.body)) return null;
  return intents;
}

export type NewSenderMail = {
  direction: "inbound" | "outbound";
  from: string | null;
  fromName: string | null;
  subject: string | null;
  body: string;
  /** Received time (ISO). */
  at: string;
  providerMessageId: string;
};
export type PriorReply = { mode: "live" | "test"; messageId: string | null };
/** Who the address already belongs to (read-only lookups; any one means "not a new sender"). */
export type KnownSender = { owner: boolean; partner: boolean; staff: boolean };
export type NewSenderFacts = {
  mail: NewSenderMail;
  known: KnownSender;
  /** Earlier `email_new_sender_replied` events for this sender address. */
  priorReplies: PriorReply[];
  /** Pre-classified intents (the copier already ran the classifier); classified here when absent. */
  hits?: IntentHit[];
  now: Date;
};
export type NewSenderDecision =
  | { kind: "reply"; email: string; intents: EmailIntent[] }
  | { kind: "skip"; reason: string };

export const SKIP_ALREADY_REPLIED = "This sender was already sent the website reply (one reply per sender, ever)";
export const NOT_KNOWN: KnownSender = { owner: false, partner: false, staff: false };

/** The ONE decision: does this sender get the website reply? Fails closed; every skip names its reason. */
export function decideNewSenderReply(f: NewSenderFacts): NewSenderDecision {
  const m = f.mail;
  const skip = (reason: string): NewSenderDecision => ({ kind: "skip", reason });
  if (m.direction !== "inbound") return skip("Only inbound mail gets the website reply");
  const email = normaliseSender(m.from);
  if (!EMAIL_SHAPE.test(email)) return skip("The email has no sender address to reply to");
  if (!isHumanOwnerEmail({ direction: m.direction, provider: "outlook", channel: "email", from: email, subject: m.subject, body: m.body })
    || AUTOMATED_SENDER.test(email) || BULK_BODY.test(m.body)) return skip("Automated, bounce, mailing-list or no-reply mail never gets a reply");
  if (isStaffDomain(email) || f.known.staff) return skip("Sender is one of our own staff");
  if (!recentEnoughForAction(m.at, f.now)) return skip("Too old for a reply");
  if (f.known.owner) return skip("Sender is already an owner on file — the office matches their email to their job");
  if (f.known.partner) return skip("Sender is a partner — partner mail is handled by the reply drafter");
  const intents = enquiryLikeIntents({ subject: m.subject, body: m.body, from: email, hits: f.hits });
  if (!intents) return skip("Not an enquiry or a price / rebate / eligibility question — waits for the office's Match");
  if (f.priorReplies.some((r) => r.mode === "live")) return skip(SKIP_ALREADY_REPLIED);
  if (f.priorReplies.some((r) => r.mode === "test" && r.messageId === m.providerMessageId)) return skip("A test reply was already sent for this email");
  return { kind: "reply", email, intents };
}

export type SendMode = { mode: "send" } | { mode: "test_send" } | { mode: "held"; reason: string };
export const HELD_UNAPPROVED = "Wording not approved (NEW_SENDER_REPLY_APPROVED is off) — nothing sent";
export const HELD_TEST_ONLY = "TEST mode: sender is not on the reply allow-list — nothing sent";
export const HELD_COMMS_OFF = "customer_comms_enabled is off — nothing sent";

export const onTestAllowList = (from: string | null | undefined) => REPLY_TEST_ALLOWLIST.includes(normaliseSender(from));

/** How the reply goes out. Needs the approved flag. TEST mode: allow-listed senders only, through test-send. Live: a
 *  real sender also needs `customer_comms_enabled`. Fails closed: an unreadable switch (null) counts as off. */
export function newSenderReplyMode(x: { approved: boolean; testOnly: boolean; commsEnabled: boolean | null; from: string | null }): SendMode {
  if (!x.approved) return { mode: "held", reason: HELD_UNAPPROVED };
  if (x.testOnly) return onTestAllowList(x.from) ? { mode: "test_send" } : { mode: "held", reason: HELD_TEST_ONLY };
  if (x.commsEnabled !== true) return { mode: "held", reason: HELD_COMMS_OFF };
  return { mode: "send" };
}

export const repliedSummary = (from: string, mode: "live" | "test") => `${mode === "test" ? "TEST website reply" : "Website reply"} (${NEW_SENDER_REPLY_TEMPLATE}) sent to new sender ${from}`;
