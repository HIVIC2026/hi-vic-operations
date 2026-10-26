// Decision 386 (Jo, owner, 25 Oct 2026, chosen in a box: "Auto-send simple ones"). A MATCHED OWNER's email to info@
// that asks a standard question gets ONE reply SENT automatically; anything unusual stays a decision-244 reply DRAFT
// plus a Needs me row; a conversation we replied to is filed (moved to Archive) in Outlook.
// PURE: the classifier, the standard answers and their wording. Nothing is read, sent, drafted or moved here.
// - Standard answers only (send): how do I save my spot · is my spot saved · I've answered the questions · what happens
//   next · when is my visit (a booked date) · where is my quote (sent / not yet) · how do I pay (My job). A thank-you
//   with nothing else needs no reply (`none`).
// - Everything else is a `draft` with a reason: complaints, price talk (disputes, "too high", any price question), legal /
//   ESC / rebate questions, unusual roofs or access, cancels / changes (decisions 245/337 keep priority — `skip`),
//   several jobs, attachments, more than one question, long emails, anything not recognised. Unsure = draft.
// - Never for installers, electricians, staff, partners or anyone who is not the owner on file (`skip`: unchanged path).
// - Every answer uses the owner's own facts and their own secure links from the ACTIVE step3_estimate
//   customer_estimate_links row (My job `/my-job/<token>`, Save my spot questions `/estimate/<token>/video`); a needed
//   link that is missing = draft. Never an invented link, date or price. Never the calculator: a NEW enquirer (no
//   job) is pointed only to the website's homeowner page (Jo 25 Oct) — and this module never answers one at all
//   (non-owner = skip, no link = draft, so no O76 answer ever carries a non-owner link).
// - Jo asked that owners waiting for an installer are told there is a long list and spots are released in the order
//   they were saved (`LONG_LIST`).
// Wording is a DRAFT (O76a–O76j in docs/templates/drafts/) behind OWNER_EMAIL_AUTO_REPLY_APPROVED = false: real owners
// get nothing automatic until Jo approves it (their email gets the draft + Needs me row instead); TEST jobs → test-send.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { classifyEmailIntents, type EmailIntent } from "./email-intent.core";
import { classifyIntent, latestReplyText } from "./outlook-correspondence.core";
import { firstNameOf, isEnquiryStage, slotText, type Slot } from "./email-reply.core";
import { newSenderReplySubject } from "./new-sender-reply.core";

/** DRAFT (decision 386): false until Jo approves the O76 wording. Real delivery also needs customer_comms_enabled + consent. */
export const OWNER_EMAIL_AUTO_REPLY_APPROVED: boolean = false;
/** ONE per Outlook message, written BEFORE the send (the claim; unique key per provider message id). */
export const EMAIL_AUTO_REPLIED_EVENT = "email_auto_replied";
/** Written when a claimed reply could not go (held / failed): the decision-244 draft + Needs me row follow. */
export const EMAIL_AUTO_REPLY_HELD_EVENT = "email_auto_reply_held";
/** Written after a sent reply's inbound message was moved to the Outlook Archive folder (or could not be). */
export const EMAIL_AUTO_REPLY_FILED_EVENT = "email_auto_reply_filed";
export const OWNER_EMAIL_AUTO_REPLY_PURPOSE = "owner_email_auto_reply";
/** The Needs me row reuses the decision-245 email row (`email_change_request`) with this intent: "reply needed". */
export const REPLY_NEEDED_INTENT = "reply";
export const SIGN_OFF = "Cheers, the Home Insulation Victoria team";
export const LONG_LIST = "Thousands of Victorians have registered. Spots are released in the order they were saved.";

/** Idempotency: one automatic reply per Outlook message, ever. */
export function autoReplyKey(providerMessageId: string): string {
  return `owner-email-auto-reply:v1:${providerMessageId}`;
}

// ---------------------------------------------------------------- answer types

export type AnswerType =
  | "save_spot" | "answers_save_spot" | "spot_saved" | "answers_received" | "visit_booked" | "pick_times"
  | "quote_ready" | "quote_preparing" | "quote_after_ready_check" | "how_to_pay";

/** Jo's design code per answer (drafts in docs/templates/drafts/O76*-owner-auto-reply-*.html). */
export const ANSWER_CODES: Record<AnswerType, { code: string; name: string; file: string }> = {
  save_spot: { code: "O76a", name: "How do I save my spot", file: "O76a-owner-auto-reply-save-spot.html" },
  answers_save_spot: { code: "O76b", name: "Answers in — one more tap to save the spot", file: "O76b-owner-auto-reply-answers-save-spot.html" },
  spot_saved: { code: "O76c", name: "Yes, your spot is saved", file: "O76c-owner-auto-reply-spot-saved.html" },
  answers_received: { code: "O76d", name: "We've got your answers (spot saved)", file: "O76d-owner-auto-reply-answers-received.html" },
  visit_booked: { code: "O76e", name: "When is my visit (booked date)", file: "O76e-owner-auto-reply-visit-booked.html" },
  pick_times: { code: "O76f", name: "Pick your Ready Check time", file: "O76f-owner-auto-reply-pick-times.html" },
  quote_ready: { code: "O76g", name: "Where is my quote (sent)", file: "O76g-owner-auto-reply-quote-ready.html" },
  quote_preparing: { code: "O76h", name: "Where is my quote (being prepared)", file: "O76h-owner-auto-reply-quote-preparing.html" },
  quote_after_ready_check: { code: "O76i", name: "Where is my quote (after the Ready Check)", file: "O76i-owner-auto-reply-quote-after-ready-check.html" },
  how_to_pay: { code: "O76j", name: "How do I pay", file: "O76j-owner-auto-reply-how-to-pay.html" },
};
export const ANSWER_TYPES = Object.keys(ANSWER_CODES) as AnswerType[];

// ---------------------------------------------------------------- facts

export type VisitKind = "ready_check" | "piesa" | "install";
export const VISIT_WORDS: Record<VisitKind, string> = { ready_check: "free Ready Check", piesa: "electrical safety check", install: "install" };

/** The owner's job facts, read by the server (read-only) for the ONE matched job. */
export type OwnerJobFacts = {
  stage: string;
  ownerFullName: string | null;
  spotSaved: boolean;
  /** The three insulation questions were answered (`owner_insulation_details_answered`). */
  questionsAnswered: boolean;
  /** The next CONFIRMED visit still to come, if any (from bookings). */
  nextVisit: { kind: VisitKind; slot: Slot } | null;
  /** Latest installation quote SENT to the owner (private drafts never passed). */
  quoteStatus: "issued" | "accepted" | "declined" | null;
  /** Links from the ACTIVE, unexpired step3_estimate customer_estimate_links row; null when there is none. */
  myJobLink: string | null;
  questionsLink: string | null;
};

export type AutoReplyInput = {
  subject: string | null;
  body: string;
  fromName: string | null;
  hasAttachments: boolean;
  attachments: { name: string; contentType?: string | null; isInline?: boolean }[];
  /** How many jobs the email was filed on. */
  jobCount: number;
  /** From address is the job owner's email on file. */
  senderIsOwner: boolean;
  /** From address is a partner business / worker / applicant, or a staff member. */
  senderIsPartnerOrStaff: boolean;
  job: OwnerJobFacts | null;
};

export type AutoReplyDecision =
  | { kind: "send"; answer: AnswerType; link: string; facts: AnswerFacts }
  | { kind: "none"; reason: string }
  | { kind: "draft"; reason: string }
  | { kind: "skip"; reason: string };

export type AnswerFacts = { firstName: string | null; link: string; visit?: { kind: VisitKind; slot: Slot } | null };

// ---------------------------------------------------------------- topic detection (latest reply text only)

export type Topic = "save_spot" | "spot_status" | "answered" | "next" | "visit_when" | "quote_where" | "how_to_pay";

const TOPICS: { topic: Topic; re: RegExp }[] = [
  { topic: "save_spot", re: /\b(how (do|can|would|should) (i|we) (save|book|hold|secure|lock in|reserve) (my|our|a|the) (spot|place)|(where|how) (do|can) (i|we) save|save (my|our) (spot|place))\b/i },
  { topic: "spot_status", re: /\b((is|has) (my|our|the) (spot|place) (been )?(saved|booked|held|secured|confirmed|locked in)|did (my|our|the) (spot|place) (save|get saved|go through|work)|(am i|are we) (on|in) the (list|queue)|(my|our) (spot|place) (is )?(saved|confirmed))\b/i },
  { topic: "answered", re: /\b((i|we)( have|'ve| just)? (answered|done|completed|filled( in| out)?|submitted) (the |your |those |all |all the )?(three |3 )?(questions|survey|form)|answered (the |your |all )?(three |3 )?questions)\b/i },
  { topic: "next", re: /\b(what('s| is| are)? (the )?next( steps?)?|what happens (now|next)|where (are|is) (we|it|things|my job|our job) (at|up to)|what do (i|we) (need to )?do (now|next)|any (update|news)|next steps?)\b/i },
  { topic: "visit_when", re: /\b(when (is|are|will|does|do) (my|our|the|you|they|someone|the installer|the electrician)\b[^.?!]{0,40}\b(visit|ready check|come|coming|install(ation|er)?|safety check|electrician|inspection|appointment|booking|arrive)|what (day|date|time) (is|are|will) (my|our|the|you|they)\b|(my|our) (booking|appointment|visit) (date|time|day))\b/i },
  { topic: "quote_where", re: /\b((where('s| is)|when (will|do|can) (i|we) (get|receive|see)|(have|has)(n't| not) (got|received|seen|arrived)|still waiting (for|on)|any (news|update) on|not (yet )?received) (my|our|the|a) quote|where('s| is) (my|our|the) quote|quote\b[^.?!]{0,20}\b(yet|arrived|been sent))\b/i },
  { topic: "how_to_pay", re: /\b(how (do|can|should) (i|we) (make (a |the )?)?pay(ment)?|(where|how) (do i|can i|to) (make )?(the |a )?payment|pay (the|my|our) (deposit|balance|invoice|bill)|(bank|payment) details)\b/i },
];

/** Things that are never a standard question → always a draft for a person. */
export const UNUSUAL: { why: string; re: RegExp }[] = [
  { why: "complaint or unhappy owner", re: /\b(complain(t|ts|ing)?|disappoint(ed|ing)|unhappy|not happy|angry|upset|frustrat\w*|terrible|awful|appalling|disgust\w*|unacceptable|ridiculous|rude|worst|poor service|bad service|refund|damage[ds]?|broke|broken|mess|leak(s|ing)?|scam|rip[- ]?off|misleading|lied|lying|never again|bad review|not good enough)\b/i },
  { why: "price or cost (disputes and price questions are answered by a person)", re: /\b(too (high|expensive|much|dear|steep)|expensive|over-?priced|cheaper|steep|discount|negotiat\w*|price match|other quotes?|competitor|how much|price[sdy]?|pricing|costs?|costing|charged?|fees?|afford(able)?)\b|\$\s?\d/i },
  { why: "legal, ESC or rebate question", re: /\b(legal|lawyer|solicitor|sue|court|tribunal|vcat|ombudsman|consumer affairs|accc|esc|essential services commission|veecs?|veu|rebate|eligib\w*|certificate|compliance|contract|terms and conditions|cooling[- ]off|warranty|insurance|privacy|unsubscribe|stop emailing|remove me)\b/i },
  { why: "roof, ceiling access or an unusual home", re: /\b(roof|tiles?|tiled|metal roof|tin roof|flat roof|skillion|cathedral|raked|manhole|man hole|hatch|access|crawl ?space|attic|loft|two[- ]stor(e)?y|double[- ]stor(e)?y|split[- ]level|asbestos|vermiculite|downlights?|solar|duct(ed|ing|s)?|pests?|rats?|mice|possums?|wasps?|mou?ld|sagging|extension|granny flat|townhouse|apartment)\b/i },
  { why: "change of plans, tenancy or sale", re: /\b(cancel\w*|postpone|re-?schedule|not interested|don'?t want|no longer|sell(ing)?|sold|moving|moved|tenants?|landlord|rent(al|ing)?|passed away|deceased|hospital)\b/i },
  { why: "urgent or safety worry", re: /\b(urgent(ly)?|asap|emergency|danger(ous)?|unsafe|fire|smoke|sparks?|electric shock|burning)\b/i },
];

const THANKS = /\b(thanks?|thank you|thankyou|cheers|much appreciated|appreciate it|great|perfect|awesome|lovely|wonderful|brilliant|excellent|sounds good|got it|received|no worries|all good)\b/i;
/** Longer than this (latest reply only) is never answered automatically. */
export const MAX_AUTO_CHARS = 600;

/** The text that counts: the owner's latest reply, plus the subject only when it is their own (not "Re:"/"Fw:"). */
export function ownText(subject: string | null, body: string): string {
  const s = (subject ?? "").trim();
  const own = s && !/^(re|fw|fwd|aw)\s*:/i.test(s) ? `${s}\n` : "";
  return `${own}${latestReplyText(body)}`.trim();
}

export function topicsIn(text: string): Topic[] {
  return TOPICS.filter((t) => t.re.test(text)).map((t) => t.topic);
}

export function unusualIn(text: string): string | null {
  return UNUSUAL.find((u) => u.re.test(text))?.why ?? null;
}

/** A thank-you / "got it" with nothing else in it: no question mark, short, no standard topic. */
export function thanksOnly(text: string): boolean {
  return THANKS.test(text) && !text.includes("?") && text.replace(/\s+/g, " ").length <= 160 && topicsIn(text).length === 0;
}

const CHANGE_INTENTS: readonly EmailIntent[] = ["cancel", "reschedule", "contact_change", "attachment"];

// ---------------------------------------------------------------- stage groups

/** Spot saved and waiting for an installer to offer Ready Check times (the long list). */
export const WAITING_STAGES: ReadonlySet<string> = new Set(["spot_saved", "ready_check_ready_to_schedule", "preliminary_estimate_ready"]);
export const PICK_TIMES_STAGES: ReadonlySet<string> = new Set(["ready_check_awaiting_acceptance"]);
export const QUOTE_PREPARING_STAGES: ReadonlySet<string> = new Set(["ready_check_complete", "ready_for_installer_quotes"]);
export const QUOTE_SENT_STAGES: ReadonlySet<string> = new Set(["measured_estimate_ready", "awaiting_quote_acceptance"]);
/** Stages where nothing is answered automatically. */
export const NEVER_STAGES: ReadonlySet<string> = new Set(["cancelled", "on_hold", "complete", "not_eligible", "ineligible", "closed"]);

const isWaiting = (f: OwnerJobFacts) => f.spotSaved && WAITING_STAGES.has(f.stage);
const isSaveSpot = (f: OwnerJobFacts) => !f.spotSaved && isEnquiryStage(f.stage, false);

// ---------------------------------------------------------------- the classifier

type Pick = { answer: AnswerType; link: string | null; visit?: OwnerJobFacts["nextVisit"] } | { draft: string };

function saveSpotAnswer(f: OwnerJobFacts): Pick {
  return { answer: f.questionsAnswered ? "answers_save_spot" : "save_spot", link: f.questionsLink };
}
function waitingAnswer(f: OwnerJobFacts, answered = false): Pick {
  return { answer: answered ? "answers_received" : "spot_saved", link: f.myJobLink };
}
function visitAnswer(f: OwnerJobFacts): Pick | null {
  return f.nextVisit ? { answer: "visit_booked", link: f.myJobLink, visit: f.nextVisit } : null;
}

function answerFor(topic: Topic, f: OwnerJobFacts): Pick {
  switch (topic) {
    case "save_spot":
    case "spot_status":
      if (isSaveSpot(f)) return saveSpotAnswer(f);
      if (isWaiting(f)) return waitingAnswer(f);
      return { draft: "the owner's spot question doesn't fit where the job is up to" };
    case "answered":
      if (!f.questionsAnswered) return { draft: "the owner says they answered the questions but no answers are recorded" };
      if (isSaveSpot(f)) return saveSpotAnswer(f);
      if (isWaiting(f)) return waitingAnswer(f, true);
      return { draft: "the owner's answers email doesn't fit where the job is up to" };
    case "visit_when":
      return visitAnswer(f) ?? (isWaiting(f) ? waitingAnswer(f) : isSaveSpot(f) ? saveSpotAnswer(f) : { draft: "no booked visit to give the owner" });
    case "next":
      if (isSaveSpot(f)) return saveSpotAnswer(f);
      if (isWaiting(f)) return waitingAnswer(f);
      if (PICK_TIMES_STAGES.has(f.stage)) return { answer: "pick_times", link: f.myJobLink };
      if (f.nextVisit) return visitAnswer(f)!;
      if (QUOTE_PREPARING_STAGES.has(f.stage)) return { answer: "quote_preparing", link: f.myJobLink };
      if (QUOTE_SENT_STAGES.has(f.stage) && f.quoteStatus === "issued") return { answer: "quote_ready", link: f.myJobLink };
      return { draft: "no standard next step for this stage" };
    case "quote_where":
      if (f.quoteStatus === "issued" && QUOTE_SENT_STAGES.has(f.stage)) return { answer: "quote_ready", link: f.myJobLink };
      if (f.quoteStatus) return { draft: "the quote was already accepted or declined" };
      if (QUOTE_PREPARING_STAGES.has(f.stage)) return { answer: "quote_preparing", link: f.myJobLink };
      // Decision 388: before release the owner is never told when the quote comes — the spot-saved answer instead.
      if (isWaiting(f)) return waitingAnswer(f);
      if (PICK_TIMES_STAGES.has(f.stage) || (f.stage === "ready_check_scheduled" && f.nextVisit?.kind === "ready_check"))
        return { answer: "quote_after_ready_check", link: f.myJobLink, visit: f.nextVisit?.kind === "ready_check" ? f.nextVisit : null };
      return { draft: "no standard quote answer for this stage" };
    case "how_to_pay":
      if (f.quoteStatus === "accepted") return { answer: "how_to_pay", link: f.myJobLink };
      return { draft: "nothing is due to pay on My job yet (no accepted quote)" };
  }
}

/** Decide: send ONE standard answer, no reply needed, a draft for a person (with the reason), or skip (not ours). */
export function decideOwnerAutoReply(i: AutoReplyInput): AutoReplyDecision {
  if (i.senderIsPartnerOrStaff) return { kind: "skip", reason: "sender is a partner or staff member — never answered automatically" };
  if (!i.senderIsOwner) return { kind: "skip", reason: "sender is not the owner on file" };
  const intents = classifyEmailIntents({ subject: i.subject, body: i.body, direction: "inbound", hasAttachments: i.hasAttachments, attachments: i.attachments });
  // Decisions 245/337 keep priority: change / cancel / contact / attachment asks already get their reply or office row.
  const change = intents.find((h) => CHANGE_INTENTS.includes(h.intent));
  if (change) return { kind: "skip", reason: `decision 245/337 handles it (${change.intent})` };
  if (i.jobCount !== 1) return { kind: "draft", reason: "the email matches more than one job" };
  const f = i.job;
  if (!f) return { kind: "draft", reason: "the job's facts could not be read" };
  if (i.attachments.some((a) => !a.isInline) || (i.hasAttachments && !i.attachments.length)) return { kind: "draft", reason: "attachments need a person to look" };
  const text = ownText(i.subject, i.body);
  if (!text) return { kind: "draft", reason: "no text in the email" };
  const decline = classifyIntent(i.body);
  if (decline.kind !== "none") return { kind: "draft", reason: "the owner may not want to go ahead" };
  const odd = unusualIn(text);
  if (odd) return { kind: "draft", reason: odd };
  if (thanksOnly(text)) return { kind: "none", reason: "thank-you only — no reply needed" };
  if (text.length > MAX_AUTO_CHARS) return { kind: "draft", reason: "long email — a person should read it" };
  if ((text.match(/\?/g) ?? []).length > 2) return { kind: "draft", reason: "several questions" };
  if (NEVER_STAGES.has(f.stage)) return { kind: "draft", reason: `job is ${f.stage.replace(/_/g, " ")}` };
  const topics = topicsIn(text);
  if (!topics.length) return { kind: "draft", reason: "no standard question recognised" };
  const picks = topics.map((t) => answerFor(t, f));
  const firstDraft = picks.find((p): p is { draft: string } => "draft" in p);
  if (firstDraft) return { kind: "draft", reason: firstDraft.draft };
  const answers = [...new Set(picks.map((p) => (p as { answer: AnswerType }).answer))];
  if (answers.length !== 1) return { kind: "draft", reason: "more than one question" };
  const pick = picks[0] as { answer: AnswerType; link: string | null; visit?: OwnerJobFacts["nextVisit"] };
  if (!pick.link) return { kind: "draft", reason: "no working secure link for this owner" };
  return { kind: "send", answer: pick.answer, link: pick.link, facts: { firstName: firstNameOf(f.ownerFullName) ?? firstNameOf(i.fromName), link: pick.link, visit: pick.visit ?? null } };
}

// ---------------------------------------------------------------- mode

export type AutoReplyMode = { mode: "test_send" } | { mode: "live" } | { mode: "held"; reason: string };

/** TEST jobs → test-send only; real owners → only with the approved flag and customer_comms_enabled. */
export function autoReplyMode(i: { testJob: boolean; approved: boolean; commsEnabled: boolean | null }): AutoReplyMode {
  if (i.testJob) return { mode: "test_send" };
  if (!i.approved) return { mode: "held", reason: "the automatic reply wording is waiting for Jo's approval" };
  if (i.commsEnabled !== true) return { mode: "held", reason: "customer comms are switched off" };
  return { mode: "live" };
}

// ---------------------------------------------------------------- wording (DRAFT, O76a–O76j; design docs/templates/mjml/waiting_O76*.mjml)

/** The quote screen of the owner's own My job link. */
export function quoteScreenLink(myJobLink: string): string {
  return `${myJobLink.replace(/[?#].*$/, "").replace(/\/+$/, "")}?screen=quote`;
}

export type AnswerParagraphs = { greeting: string; lines: string[]; linkLine: string; signOff: string };

/** The approved MJML design per answer (docs/templates/mjml/waiting_O76a–j.mjml): heading, body lines, one button. */
type AnswerDesign = { heading: string; body: string[]; bold: string | null; button: string; href: string; preview: string | null };

function answerDesign(answer: AnswerType, f: AnswerFacts): AnswerDesign {
  const v = f.visit ?? null;
  const when = v ? slotText(v.slot) : null;
  // Decision 388: before release, never an installer, times or a Ready Check — only that we'll be in touch.
  const waitingNext = `${LONG_LIST} We'll be in touch when yours is released.`;
  const pickTimes = "Your installer has offered some times. Just pick the one that suits you.";
  const d = (heading: string, body: string[], button: string, preview: string | null, href = f.link, bold: string | null = null): AnswerDesign => ({ heading, body, bold, button, href, preview });
  switch (answer) {
    case "save_spot":
      return d("It only takes a few seconds", ["Answer three quick questions about your ceiling (just tap, no typing), then press Save my spot.", `${LONG_LIST} No payment, no obligation.`], "Answer & save my spot", "Three quick taps, then one button. No payment needed.");
    case "answers_save_spot":
      return d("One more tap to save your spot", ["Thanks, we've got your answers. Now just press Save my spot.", `${LONG_LIST} No payment, no obligation.`], "Save my spot", "Thanks for answering. Your spot isn't saved until you press the button.");
    case "spot_saved":
      return d("Yes, your spot is saved", ["There's nothing more you need to do right now.", waitingNext], "See where you're up to", "There's nothing more you need to do right now.");
    case "answers_received":
      return d("Thanks, your spot is saved", ["We've got your answers.", waitingNext], "See where you're up to", "We've got your answers and there's nothing more to do right now.");
    case "visit_booked":
      return v && when
        ? d(`Your ${VISIT_WORDS[v.kind]} is booked`, [`It's on ${when}.`], "See the details", `It's on ${when}.`, f.link, when)
        : d("Your visit is booked", [], "See the details", null);
    case "pick_times":
      return d("Pick a time for your free Ready Check", [pickTimes], "Pick your time", "Your installer has offered some times. Pick the one that suits you.");
    case "quote_ready":
      return d("Your quote is ready", ["You can read it and accept it on your page."], "See your quote", "You can read it and accept it on your page.", quoteScreenLink(f.link));
    case "quote_preparing":
      return d("Your quote is being prepared", ["Your Ready Check is done. We'll email you as soon as your quote is ready."], "See where you're up to", "Your Ready Check is done. We'll email you when your quote is ready.");
    case "quote_after_ready_check":
      // Only after release (times offered or a Ready Check booked); waiting owners get the spot-saved answer.
      return when
        ? d("Your quote comes after your free Ready Check", ["That's when the installer measures your ceiling.", `Your Ready Check is booked for ${when}.`], "See where you're up to", `Your Ready Check is booked for ${when}.`, f.link, when)
        : d("Your quote comes after your free Ready Check", ["That's when the installer measures your ceiling.", pickTimes], "See where you're up to", "Your installer has offered some times. Pick the one that suits you.");
    case "how_to_pay":
      return d("How to pay", ["Everything you need is on your page, including the amount and the ways to pay."], "See what's due and how to pay", "The amount and the ways to pay are on your page.");
  }
}

/** Plain-text parts in the order of the email: greeting, heading + lines, the button's link, the team sign-off. */
export function answerParagraphs(answer: AnswerType, f: AnswerFacts): AnswerParagraphs {
  const d = answerDesign(answer, f);
  return { greeting: `Hi ${f.firstName ?? "there"},`, lines: [d.heading, ...d.body], linkLine: `${d.button}: ${d.href}`, signOff: SIGN_OFF };
}

/** The reply as one plain-text body (also what the tests and the Templates page read). */
export function answerText(answer: AnswerType, f: AnswerFacts): string {
  const p = answerParagraphs(answer, f);
  return [p.greeting, "", ...p.lines, "", p.linkLine, "", p.signOff].join("\n");
}

export type OwnerAutoReplyEmail = { subject: string; html: string; text: string };

/** One short quick-reply email per answer (approved MJML design): greeting, heading, 1–2 lines, one button, sign-off. Subject "Re: {theirs}". */
export function renderOwnerAutoReplyEmail(i: { answer: AnswerType; facts: AnswerFacts; theirSubject: string | null; unsubscribe?: string | null; test?: boolean }): OwnerAutoReplyEmail {
  const d = answerDesign(i.answer, i.facts);
  const subject = newSenderReplySubject(i.theirSubject);
  const line = (l: string) => (d.bold && l.includes(d.bold) ? l.split(d.bold).map(esc).join(`<strong>${esc(d.bold)}</strong>`) : esc(l));
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${esc(`Hi ${i.facts.firstName ?? "there"},`)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(d.heading)}</mj-text>${d.body.map((l) => `<mj-text>${line(l)}</mj-text>`).join("")}<mj-button href="${esc(d.href)}">${esc(d.button)}</mj-button><mj-text padding="0 12px 6px">Cheers,<br />the Home Insulation Victoria team</mj-text></mj-column></mj-section>`;
  return {
    subject,
    html: mjEmail({ subject, preview: d.preview, body, unsubscribe: i.unsubscribe ?? null, testLabel: i.test === true }),
    text: K.plainText([answerText(i.answer, i.facts)], { testLabel: i.test === true, unsubscribe: i.unsubscribe ?? null }),
  };
}

// ---------------------------------------------------------------- fixed samples (drafts, Templates page, tests)

export const SAMPLE_MY_JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/TEST";
export const SAMPLE_QUESTIONS = "https://estimate.homeinsulationvictoria.com.au/estimate/TEST/video";
const SAMPLE_RC: Slot = { start: "2026-10-27T21:00:00Z", end: null }; // Wednesday 28 October, 8am Melbourne
export const ANSWER_SAMPLES: Record<AnswerType, { theirSubject: string; facts: AnswerFacts }> = {
  save_spot: { theirSubject: "How do I save my spot?", facts: { firstName: "Helen", link: SAMPLE_QUESTIONS } },
  answers_save_spot: { theirSubject: "Questions", facts: { firstName: "Helen", link: SAMPLE_QUESTIONS } },
  spot_saved: { theirSubject: "Is my spot saved?", facts: { firstName: "Helen", link: SAMPLE_MY_JOB } },
  answers_received: { theirSubject: "Answered the questions", facts: { firstName: "Helen", link: SAMPLE_MY_JOB } },
  visit_booked: { theirSubject: "Ready Check", facts: { firstName: "Helen", link: SAMPLE_MY_JOB, visit: { kind: "ready_check", slot: SAMPLE_RC } } },
  pick_times: { theirSubject: "What happens next?", facts: { firstName: "Helen", link: SAMPLE_MY_JOB } },
  quote_ready: { theirSubject: "Where is my quote?", facts: { firstName: "Helen", link: SAMPLE_MY_JOB } },
  quote_preparing: { theirSubject: "Quote", facts: { firstName: "Helen", link: SAMPLE_MY_JOB } },
  quote_after_ready_check: { theirSubject: "Quote", facts: { firstName: "Helen", link: SAMPLE_MY_JOB, visit: { kind: "ready_check", slot: SAMPLE_RC } } },
  how_to_pay: { theirSubject: "Payment", facts: { firstName: "Helen", link: SAMPLE_MY_JOB } },
};

export function renderAnswerSample(answer: AnswerType): OwnerAutoReplyEmail {
  const s = ANSWER_SAMPLES[answer];
  return renderOwnerAutoReplyEmail({ answer, facts: s.facts, theirSubject: s.theirSubject });
}
