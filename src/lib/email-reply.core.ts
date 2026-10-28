// Decision 244 (Jo 24 Oct 2026): "Inbox auto-replies: draft first, then switch on per type." PURE reply drafter.
// For a matched inbound email (owner or partner) pick ONE reply type from the email-intent result and compose a short
// plain-English reply in Jo's tone from the job's own facts and approved wording only:
//   Hi {first name}, · 2–5 short sentences · at most one link · "Jo, Home Insulation Victoria".
// Never invents a fact: a missing fact becomes "the office will check … and confirm it with you" and the draft is
// flagged "check before sending". Never mentions internal margins, partner pay to owners, or other customers.
// Nothing here reads, writes, drafts or sends; `email-reply.server.ts` writes the Outlook DRAFT (never sends).
// Wording sources: O1/O2 Save my spot, O6 not eligible, O18 quote ready (docs/templates/owner/), installer guide
// GUIDE_WORDS (trade-view.core), job-wording owner lines, decisions 139–144 (payments), 205/244/245.
// Matched owners' replies point to their own HOMEOWNER PAGE (secure estimate / My job link), never the calculator.
// Decision 292 (Jo 25 Oct, replaces 255): an unmatched NEW sender is NOT drafted for here and never gets an enquiry
// created from their email — new-sender-reply.core sends them the one website reply (O70); every other unmatched
// non-partner email waits for the office's Match (decision 247).
import { SPOT_IN_TOUCH, SPOT_ORDER } from "./spot-only-copy.core";
import { classifyEmailIntents, looksLikeNewEnquiry, type EmailIntent, type IntentHit } from "./email-intent.core";
import { CUSTOMER_BASE } from "./engagement.core";
import type { PayState } from "./trade-view.core";
import { REPLY_TEST_ALLOWLIST } from "./outlook-reply-drafts.core";

export type ReplyType = "owner_status" | "new_enquiry" | "price_rebate_eligibility" | "partner";
export const REPLY_TYPES: readonly ReplyType[] = ["owner_status", "new_enquiry", "price_rebate_eligibility", "partner"];
export const REPLY_TYPE_LABEL: Record<ReplyType, string> = {
  owner_status: "Where is my job",
  new_enquiry: "New enquiry",
  price_rebate_eligibility: "Price, rebate and eligibility",
  partner: "Installer / electrician",
};

export const EMAIL_REPLY_DRAFTED_EVENT = "email_reply_drafted";
// Master switch (OFF), TEST mode (ON) and the TEST allow-list live in the import-free outlook-reply-drafts.core so the
// Outlook copier can check them without loading the drafter.
export { EMAIL_REPLY_DRAFTS_ENABLED, EMAIL_REPLY_DRAFTS_TEST_ONLY, REPLY_TEST_ALLOWLIST } from "./outlook-reply-drafts.core";
/** Per-type automatic sending (decision 244: Jo switches types on later). NOT BUILT: every type stays false and no code
 *  path sends. TODO(decision 244): when Jo approves a type, add a guarded sender behind `customer_comms_enabled` +
 *  owner consent and flip that type here; `wouldAutoSend` is the only decision it may use. */
export const REPLY_AUTO_SEND: Readonly<Record<ReplyType, boolean>> = { owner_status: false, new_enquiry: false, price_rebate_eligibility: false, partner: false };

export const SIGN_OFF = "Jo, Home Insulation Victoria";
export const CHECK_BEFORE_SENDING = "Check before sending";
export const OFFICE_EMAIL = "info@homeinsulationvictoria.com.au";
export const TRADE_PORTAL_URL = `${CUSTOMER_BASE}/field`;

// ---------- Facts (read by the server from the live job / partner records) ----------
export type Money = { fullPrice: number; rebate: number; youPay: number };
export type Slot = { start: string; end: string | null };
export type DueStep = { key: import("./payments.core").PaymentStepKey; outstanding: number; dueAt: string | null; state: "requested" | "overdue"; cardAvailable: boolean };

export type OwnerFacts = {
  jobNumber: string;
  jobSource: string | null;
  stage: string;
  spotSaved: boolean;
  ownerFullName: string | null;
  suburb: string | null;
  /** Next confirmed visits (Melbourne-local formatting happens here). */
  readyCheck: Slot | null;
  piesa: Slot | null;
  install: Slot | null;
  /** Latest installation quote the owner has been SENT (issued/accepted/declined); private drafts are never passed. */
  quote: (Money & { status: "issued" | "accepted" | "declined" }) | null;
  /** Fixes quote sent to the owner and waiting for approval. */
  fixesQuoteSent: boolean;
  /** Current indicative estimate (Step 3), standard access, primary scenario. */
  estimate: (Money & { areaM2: number | null }) | null;
  /** Owner-declared existing insulation from the enquiry: none / present / unknown. */
  insulationDeclared: "none" | "present" | "unknown" | null;
  /** First payment step due now, from the payment ledger (decisions 139–144). */
  paymentDue: DueStep | null;
  /** 48h provisional install hold (decision 141): when it lapses if the deposit is unpaid. */
  installHeldUntil: string | null;
  /** The owner's secure estimate / My job link (never minted by the drafter). */
  ownerLink: string | null;
  /** How many jobs the message matched (one draft per message; >1 is flagged). */
  matchedJobs: number;
};

export type PartnerOffer = { kind: string; suburb: string | null; expiresAt: string | null };
export type PartnerPayRow = { jobNumber: string; what: string; state: PayState; channel: string | null };
export type PartnerFacts = {
  businessName: string | null;
  kind: "installer" | "electrician" | null;
  /** Sender is a known partner business. False = trade-sounding mail from an unknown address. */
  known: boolean;
  isTest: boolean;
  offers: PartnerOffer[];
  /** Own completed work only (business owner view): pay state per job, never amounts in the reply. */
  pay: PartnerPayRow[];
  /** Job numbers written in the email that ARE assigned to this business (others are never named). */
  ownJobNumbers: string[];
};

export type ReplyInput = {
  subject: string | null;
  body: string;
  from: string | null;
  fromName: string | null;
  hits?: IntentHit[];
  fromPartner: boolean;
  owner?: OwnerFacts | null;
  partner?: PartnerFacts | null;
  now: Date;
};

export type ReplyDraft = {
  type: ReplyType;
  /** Plain text body (greeting … sign-off). */
  text: string;
  /** Same content as simple HTML paragraphs (one anchor at most). */
  html: string;
  link: string | null;
  checkBeforeSending: boolean;
  /** Why the draft needs a check (missing facts, multiple jobs, cancel, unknown sender …). Internal only. */
  flags: string[];
  intents: EmailIntent[];
};

// ---------- Formatting ----------
const TZ = "Australia/Melbourne";
export function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${(whole ? Math.round(n) : n).toLocaleString("en-AU", whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const dayText = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).replace(",", "");
const timeText = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(":00", "").replace(/\s/g, "").toLowerCase();
/** "Tuesday 28 October at 9am": the exact arrival time only (decision 43: no time windows). */
export function slotText(s: Slot): string {
  return `${dayText(s.start)} at ${timeText(s.start)}`;
}
const dateTimeText = (iso: string) => `${timeText(iso)} ${dayText(iso)}`;

/** "Helen" from "helen mary citizen"; null when nothing usable. */
export function firstNameOf(full: string | null | undefined): string | null {
  const w = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[a-z][a-z'-]{1,}$/i.test(w) || /@/.test(w)) return null;
  return w[0]!.toUpperCase() + w.slice(1).toLowerCase();
}

// ---------- Type selection ----------
const ENQUIRY_STAGES = new Set(["new_enquiry", "eligibility_review", "preliminary_estimate_ready"]);
const MITTI_CUE = /\b(mitti|onsite form|ready check form|install form|piisa form|the form)\b/i;
const PAY_CUE = /\b(paid|pay|payment|remittance|invoice|payout|when do (i|we) get)\b/i;
const OFFER_CUE = /\b(offer|offers|new jobs?|more (work|jobs)|any work|jobs? (coming|available))\b/i;

export const isEnquiryStage = (stage: string | null | undefined, spotSaved = false) =>
  !!stage && ENQUIRY_STAGES.has(stage) && !(stage === "preliminary_estimate_ready" && spotSaved);

/** The enquiry cue lives in the intent core (shared with the decision-292 website reply). */
export { looksLikeNewEnquiry };

/** The ONE reply type for this email, or null (nothing we can usefully answer → no draft). An unmatched non-partner
 *  email is never drafted for (decision 292: new senders get the website reply; the rest wait for the office's Match). */
export function pickReplyType(i: { hits: IntentHit[]; fromPartner: boolean; matchedJob: boolean; stage: string | null; spotSaved: boolean; enquiryCue: boolean }): ReplyType | null {
  const has = (x: EmailIntent) => i.hits.some((h) => h.intent === x);
  if (i.fromPartner) return "partner";
  if (has("trade") && !i.matchedJob) return "partner";
  if (!i.matchedJob) return null;
  // "When is my free Ready Check?" / "Where is my quote?" are status questions even though they contain a price or
  // rebate word: a price/rebate ask wins only when it is a different sentence from the status ask.
  const st = i.hits.find((h) => h.intent === "question_status");
  const priceAsk = i.hits.some((h) => (h.intent === "question_price" || h.intent === "question_rebate") && (!st || h.phrase !== st.phrase));
  if (priceAsk) return "price_rebate_eligibility";
  if (isEnquiryStage(i.stage, i.spotSaved)) return "new_enquiry";
  if (has("question_status") || has("reschedule") || has("cancel") || has("contact_change") || has("attachment")) return "owner_status";
  if (has("trade")) return "partner";
  return i.enquiryCue ? "new_enquiry" : null;
}

// ---------- Composition helpers ----------
type Built = { lines: string[]; link: string | null; flags: string[]; linkLine?: string | null };
const MAX_SENTENCES = 5;
const officeConfirms = (what: string) => `The office will check ${what} and confirm it with you.`;

function render(greetName: string | null, b: Built, type: ReplyType, intents: EmailIntent[]): ReplyDraft {
  const flags = [...new Set(b.flags)];
  if (!greetName) flags.push("No first name on file — greeting says “Hi there”");
  const greeting = `Hi ${greetName ?? "there"},`;
  const room = MAX_SENTENCES - (b.linkLine ? 1 : 0);
  const body = [...b.lines.slice(0, room), ...(b.linkLine ? [b.linkLine] : [])].join(" ");
  const text = `${greeting}\n\n${body}\n\n${SIGN_OFF}`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const withLink = (s: string) => {
    const e = esc(s);
    return b.link ? e.replace(esc(b.link), `<a href="${esc(b.link)}">${esc(b.link)}</a>`) : e;
  };
  const html = `<p>${esc(greeting)}</p><p>${withLink(body)}</p><p>${esc(SIGN_OFF)}</p>`;
  const problems = forbiddenContentProblems(text);
  for (const p of problems) flags.push(`Wording check: ${p}`);
  return { type, text, html, link: b.link, checkBeforeSending: flags.length > 0, flags, intents };
}

/** Words an owner/partner reply must never contain (internal margins, partner pay to owners, other customers). */
export function forbiddenContentProblems(text: string, opts: { ownJobNumbers?: string[]; audience?: "owner" | "partner" } = {}): string[] {
  const out: string[] = [];
  if (/\b(margin|mark-?up|our cost|cost price|commission|quote_internals|internal)\b/i.test(text)) out.push("mentions internal pricing");
  if ((opts.audience ?? "owner") === "owner" && /\b(installer pay|electrician rate|payout|we pay the installer|partner pay)\b/i.test(text)) out.push("mentions partner pay");
  if (opts.ownJobNumbers) {
    const others = [...text.matchAll(/\bHV-\d{3,6}\b/g)].map((m) => m[0]).filter((n) => !opts.ownJobNumbers!.includes(n));
    if (others.length) out.push(`names another job (${[...new Set(others)].join(", ")})`);
  }
  return out;
}

const PIESA = "electrical safety check (PIESA)";
const PAY_STEP_WORDS: Record<DueStep["key"], { what: string; how: string }> = {
  safety_check: { what: "safety check payment", how: "by card or bank transfer, with no fee" },
  fixes: { what: "electrical fixes payment", how: "by card or bank transfer, with no fee" },
  install_deposit: { what: "booking payment (10%)", how: "by bank transfer or PayID" },
  balance: { what: "balance", how: "by bank transfer or PayID" },
  repeat_safety_check: { what: "repeat safety check (PIESA) payment", how: "by card or bank transfer, with no fee" },
};

/** Decision 245: the drafted reply matches the change the owner asked for (nothing is changed until the office taps Apply). */
function changeAck(intents: EmailIntent[]): { line: string | null; flags: string[]; cancel: boolean } {
  if (intents.includes("cancel")) return { line: "Thanks for letting us know you'd like to cancel, we'll confirm with you once that's done.", flags: ["Owner asks to cancel — apply it on Needs me first"], cancel: true };
  if (intents.includes("reschedule")) return { line: "Thanks for letting us know that day doesn't suit, we'll arrange a new one with you.", flags: ["Owner asks to move a booked day — rearrange it on the job"], cancel: false };
  if (intents.includes("contact_change")) return { line: "Thanks, we'll update your contact details.", flags: ["Owner asks to update contact details — apply it on Needs me"], cancel: false };
  if (intents.includes("attachment")) return { line: "Thanks for sending those through, we'll add them to your job file.", flags: [], cancel: false };
  return { line: null, flags: [], cancel: false };
}

// ---------- owner_status ----------
function ownerStatus(f: OwnerFacts, intents: EmailIntent[], now: Date): Built {
  const flags: string[] = [];
  const lines: string[] = [];
  let link: string | null = null;
  let linkLine: string | null = null;
  const ack = changeAck(intents);
  if (ack.line) lines.push(ack.line);
  flags.push(...ack.flags);
  if (f.matchedJobs > 1) flags.push(`Email matched ${f.matchedJobs} jobs — check it's about ${f.jobNumber}`);
  if (ack.cancel) {
    lines.push("If you change your mind, just reply to this email.");
    return { lines, link, flags };
  }
  if (intents.includes("reschedule")) {
    // Never restate the day they can't make; nothing moves until the office rearranges it (decision 245).
    lines.push("Nothing changes until we've confirmed the new time with you.");
    return { lines, link, flags };
  }
  const linkOr = (sentence: string, missingWhat: string) => {
    if (f.ownerLink) { link = f.ownerLink; linkLine = `${sentence} ${f.ownerLink}`; }
    else { lines.push(officeConfirms(missingWhat)); flags.push("No secure owner link on the job"); }
  };
  const due = f.paymentDue;
  // Card only where Stripe is actually available for this step (decision 144); otherwise bank transfer / PayID.
  const dueLine = (d: DueStep) => `The next step is your ${PAY_STEP_WORDS[d.key].what} of ${money(d.outstanding)}, ${d.cardAvailable ? PAY_STEP_WORDS[d.key].how : "by bank transfer or PayID"}.`;
  switch (f.stage) {
    // Decision 388: before release, spot-only wording (spot-only-copy.core).
    case "spot_saved": case "ready_check_ready_to_schedule": case "preliminary_estimate_ready":
      lines.push("Your spot is saved.", SPOT_ORDER, SPOT_IN_TOUCH);
      break;
    case "ready_check_awaiting_payment":
      lines.push("Your spot is saved.", "Certified installers are in high demand, so we book homes in the order people saved their spot.", "When an installer near you is free, they'll offer you times for your free Ready Check and we'll email them to you.");
      break;
    case "ready_check_awaiting_acceptance":
      lines.push("Your installer has offered times for your free Ready Check.");
      linkOr("You can pick the one that suits you here:", "your Ready Check times");
      break;
    case "ready_check_scheduled":
      if (f.readyCheck) lines.push(`Your free Ready Check is booked for ${slotText(f.readyCheck)}.`, "The installer will measure your ceiling and confirm the price.");
      else { lines.push(officeConfirms("your Ready Check time")); flags.push("Missing: Ready Check booking time"); }
      break;
    case "ready_check_complete": case "ready_for_installer_quotes":
      lines.push("Your Ready Check is done and your quote is being prepared.", "We'll email it to you as soon as it's ready.");
      break;
    case "measured_estimate_ready": case "awaiting_quote_acceptance":
      if (f.quote && f.quote.status === "issued") {
        lines.push(`Your quote is ready: you pay ${money(f.quote.youPay)} after the ${money(f.quote.rebate)} VEU rebate (full price ${money(f.quote.fullPrice)} incl. GST).`);
        linkOr("You can view and accept it here:", "your quote link");
      } else { lines.push(officeConfirms("your quote")); flags.push("Missing: sent quote"); }
      break;
    case "measured_quote_accepted": case "awaiting_deposit_payment":
      lines.push("Thanks for accepting your quote.");
      if (due) { lines.push(dueLine(due)); linkOr("You can pay here:", "how to pay"); }
      else lines.push(`Next is your ${PIESA} by a licensed electrician, which has to happen before any insulation goes in.`);
      break;
    case "piesa_and_install_window_pending": case "awaiting_electrician": case "assessment_booking":
      lines.push(`Next is your ${PIESA} by a licensed electrician, which has to happen before any insulation goes in.`, "We'll send you times to choose from.");
      break;
    case "piesa_scheduled": case "assessment_booked":
      if (f.piesa) lines.push(`Your ${PIESA} is booked for ${slotText(f.piesa)}.`);
      else { lines.push(officeConfirms(`your ${PIESA} time`)); flags.push("Missing: PIESA booking time"); }
      break;
    case "piesa_complete": case "assessment_complete":
      lines.push(`Your ${PIESA} is done and we're checking the result.`);
      break;
    case "rectification_required":
      lines.push("The safety check found some electrical fixes are needed, and your fixes quote is on its way.", "Nothing is done without your OK.");
      break;
    case "electrical_variation_pending": case "awaiting_owner_rectification_approval":
      lines.push("The safety check found some electrical fixes are needed.");
      if (f.fixesQuoteSent) linkOr("You can review and approve the fixes quote here:", "your fixes quote");
      else { lines.push(officeConfirms("your fixes quote")); flags.push("Missing: sent fixes quote"); }
      break;
    case "rectification_scheduling": case "rectification_booked":
      lines.push("Your electrical fixes are being arranged with the electrician.", "They need to be done and signed off before your install day can be booked.");
      break;
    case "installation_scheduling":
      lines.push("Your safety check is cleared, so your installer will offer you install days.", "Take the one that suits you, or suggest another.");
      break;
    case "installation_booked":
      if (f.install) lines.push(`Your install is booked for ${slotText(f.install)}.`);
      else { lines.push(officeConfirms("your install day")); flags.push("Missing: install booking"); }
      if (due?.key === "install_deposit") {
        lines.push(`${f.installHeldUntil && Date.parse(f.installHeldUntil) > now.getTime() ? `The day is held until ${dateTimeText(f.installHeldUntil)} while your` : "Your"} booking payment of ${money(due.outstanding)} comes through, by bank transfer or PayID.`);
        linkOr("The payment details are here:", "the payment details");
      }
      break;
    case "evidence_outstanding": case "ap_review": case "ready_for_veec":
      lines.push("Your install is done and we're finishing the paperwork.");
      if (due?.key === "balance") { lines.push(dueLine(due)); linkOr("The payment details are here:", "the payment details"); }
      break;
    case "complete":
      lines.push("Your job is all done, thank you.", "If anything doesn't look right, just reply to this email.");
      break;
    case "on_hold":
      lines.push("Your job is on hold at the moment.", officeConfirms("what's needed"));
      flags.push("Job is on hold");
      break;
    case "cancelled":
      lines.push("Your job is closed with us at the moment.", officeConfirms("whether it can be reopened"));
      flags.push("Job is cancelled");
      break;
    default:
      lines.push(officeConfirms("where your job is up to"));
      flags.push(`Unrecognised stage ${f.stage}`);
  }
  return { lines, link, linkLine, flags };
}

// ---------- new_enquiry ----------
const campaignLink = (ownerLink: string) => `${ownerLink.replace(/\/$/, "")}/campaign`;

/** A matched owner still at an enquiry stage (estimate sent, spot not saved): their own page, never the calculator. */
function newEnquiry(f: OwnerFacts): Built {
  const flags: string[] = [];
  if (f.matchedJobs > 1) flags.push(`Email matched ${f.matchedJobs} jobs — check it's about ${f.jobNumber}`);
  const lines = ["Thanks for getting in touch."];
  let link: string | null = null;
  if (f.estimate) {
    lines.push(`Your estimate${f.suburb ? ` for your ${f.suburb} home` : ""} is ready: you could save ${money(f.estimate.rebate)} with the VEU rebate and pay ${money(f.estimate.youPay)} (full price ${money(f.estimate.fullPrice)} incl. GST).`);
  } else { lines.push(officeConfirms("your estimate")); flags.push("Missing: current estimate"); }
  lines.push(SPOT_ORDER);
  let linkLine: string | null = null;
  if (f.ownerLink) { link = campaignLink(f.ownerLink); linkLine = `Save your free spot here, no payment and no obligation: ${link}`; }
  else { flags.push("No secure estimate link on the job"); }
  return { lines, link, linkLine, flags };
}

// ---------- price_rebate_eligibility ----------
function priceRebate(f: OwnerFacts): Built {
  const flags: string[] = [];
  const lines: string[] = [];
  let link: string | null = null;
  if (f.matchedJobs > 1) flags.push(`Email matched ${f.matchedJobs} jobs — check it's about ${f.jobNumber}`);
  const q = f.quote && f.quote.status !== "declined" ? f.quote : null;
  if (q) {
    lines.push(`Your quote's full price is ${money(q.fullPrice)} incl. GST, and the ${money(q.rebate)} VEU rebate comes straight off, so you pay ${money(q.youPay)} with nothing for you to claim.`);
  } else if (f.estimate) {
    lines.push(`Your estimate is ${money(f.estimate.fullPrice)} incl. GST, and the ${money(f.estimate.rebate)} VEU rebate comes straight off, so you'd pay ${money(f.estimate.youPay)}${f.estimate.areaM2 ? ` for the ${Math.round(f.estimate.areaM2)} m² ceiling you told us about` : ""}.`);
  } else {
    lines.push(officeConfirms("the price and rebate for your home"));
    flags.push("Missing: quote and estimate figures");
  }
  lines.push("That includes the free Ready Check, the licensed electrician's safety check, premium R5.0 ceiling batts fitted by an EEC-certified installer, and all the rebate paperwork.");
  const extras = q
    ? "Electrical fixes aren't included and are only needed if the safety check finds any; they're quoted separately and nothing is done without your OK."
    : "Not included, only if needed: removing old insulation, a ceiling access fee, electrical fixes, or a bigger ceiling than you told us, and you'll know the exact price before you agree to anything.";
  const rule = "The rebate is for homes over 5 years old where any insulation already in the ceiling is below R2.0.";
  let linkLine: string | null = null;
  lines.push(extras, rule);
  if (f.ownerLink) { link = f.ownerLink; linkLine = `You can see the full breakdown here: ${link}`; }
  if (f.insulationDeclared === "present" || f.insulationDeclared === "unknown") flags.push("Owner has (or isn't sure about) existing insulation — R2.0 is checked at the Ready Check");
  return { lines, link, linkLine, flags };
}

// ---------- partner ----------
/** Approved installer-guide pay rule (GUIDE_WORDS.pay: "your customers when the owner pays the balance; our leads 7 days
 *  after we approve the job"), written as a sentence. */
export const PARTNER_PAY_RULE = "For your own customers you're paid when the owner pays the balance, and for our leads 7 days after we approve the job.";
function partnerReply(p: PartnerFacts | null, text: string, now: Date): Built {
  const flags: string[] = [];
  const lines: string[] = [];
  let link: string | null = null;
  if (!p || !p.known) flags.push("Sender isn't a known partner business — check who they are before sending");
  const mitti = MITTI_CUE.test(text), pay = PAY_CUE.test(text), offer = OFFER_CUE.test(text);
  if (mitti) {
    const example = p?.ownJobNumbers[0] ?? "HV-3117";
    lines.push(`The job's Ready Check form appears in Mitti within about 15 minutes of the job being added, named with the customer's address and job number (for example ${example}), under your inspections.`);
    lines.push("Fill in as much as you can and press Complete only when it's finished, because that's what sends the owner their quote.");
  }
  if (pay) {
    const rows = p?.pay ?? [];
    const coming = rows.filter((r) => r.state.kind === "coming").sort((a, b) => (a.state as { on: string }).on.localeCompare((b.state as { on: string }).on));
    const checking = rows.filter((r) => r.state.kind === "checking");
    if (coming.length) {
      const on = (coming[0]!.state as { on: string }).on;
      const same = coming.filter((r) => (r.state as { on: string }).on.slice(0, 10) === on.slice(0, 10)).map((r) => r.jobNumber);
      lines.push(`Your next payment is due ${dayText(on)} for ${same.join(", ")}.`);
    } else if (checking.length) {
      lines.push(`${checking.slice(0, 3).map((r) => r.jobNumber).join(", ")} ${checking.length === 1 ? "is" : "are"} still being checked before payment.`);
    } else if (p?.known) {
      lines.push(officeConfirms("your payment dates"));
      flags.push("Missing: no completed paid work found for this business");
    }
    // GUIDE_WORDS.pay (approved installer guide), as a sentence.
    lines.push(PARTNER_PAY_RULE);
  }
  if (offer) {
    const open = (p?.offers ?? []).filter((o) => !o.expiresAt || Date.parse(o.expiresAt) > now.getTime());
    if (open.length) {
      const first = open.slice().sort((a, b) => (a.expiresAt ?? "9").localeCompare(b.expiresAt ?? "9"))[0]!;
      lines.push(`You have ${open.length} job offer${open.length === 1 ? "" : "s"} waiting${first.suburb ? `, including one in ${first.suburb}` : ""}${first.expiresAt ? ` that closes ${dateTimeText(first.expiresAt)}` : ""}.`);
    } else lines.push("There are no open offers for you right now; when one comes in we text and email you a link straight to it.");
  }
  if (!mitti && !pay && !offer) {
    lines.push(officeConfirms("this"));
    flags.push("Partner question not recognised (offers, Mitti forms or pay)");
  }
  let linkLine: string | null = null;
  if (p?.known) { link = TRADE_PORTAL_URL; linkLine = `Everything is in your portal: ${link}`; }
  return { lines, link, linkLine, flags };
}

// ---------- Entry point ----------
/** Compose the ONE reply draft for this email, or null when no reply type applies. Pure. */
export function composeReply(i: ReplyInput): ReplyDraft | null {
  const hits = i.hits ?? classifyEmailIntents({ subject: i.subject, body: i.body, direction: "inbound", from: i.from, fromPartner: i.fromPartner });
  const intents = hits.map((h) => h.intent);
  const owner = i.owner ?? null;
  const type = pickReplyType({ hits, fromPartner: i.fromPartner, matchedJob: !!owner, stage: owner?.stage ?? null, spotSaved: owner?.spotSaved ?? false, enquiryCue: looksLikeNewEnquiry(i.subject, i.body) });
  if (!type) return null;
  const text = `${i.subject ?? ""}\n${i.body}`;
  let built: Built;
  let name: string | null;
  switch (type) {
    case "owner_status": built = ownerStatus(owner!, intents, i.now); name = firstNameOf(owner!.ownerFullName) ?? firstNameOf(i.fromName); break;
    case "new_enquiry": built = newEnquiry(owner!); name = firstNameOf(owner!.ownerFullName) ?? firstNameOf(i.fromName); break;
    case "price_rebate_eligibility": built = priceRebate(owner!); name = firstNameOf(owner!.ownerFullName) ?? firstNameOf(i.fromName); break;
    case "partner": built = partnerReply(i.partner ?? null, text, i.now); name = firstNameOf(i.fromName); break;
  }
  const draft = render(name, built, type, intents);
  if (type === "partner") {
    const extra = forbiddenContentProblems(draft.text, { audience: "partner", ownJobNumbers: [...(i.partner?.ownJobNumbers ?? []), ...(i.partner?.pay ?? []).map((r) => r.jobNumber), "HV-3117"] });
    for (const e of extra) if (!draft.flags.includes(`Wording check: ${e}`)) draft.flags.push(`Wording check: ${e}`);
  } else if (owner) {
    const extra = forbiddenContentProblems(draft.text, { audience: "owner", ownJobNumbers: [owner.jobNumber] });
    for (const e of extra) if (!draft.flags.includes(`Wording check: ${e}`)) draft.flags.push(`Wording check: ${e}`);
  }
  draft.checkBeforeSending = draft.flags.length > 0;
  return draft;
}

// ---------- Switches / guards ----------
/** null = a draft may be written; otherwise the plain reason it was not. Fails closed. */
export function draftBlocker(x: { enabled: boolean; testOnly: boolean; from: string | null; jobSources: (string | null)[]; partnerIsTest?: boolean | null }): string | null {
  if (!x.enabled) return "Reply drafts are switched off (EMAIL_REPLY_DRAFTS_ENABLED)";
  if (!x.testOnly) return null;
  const from = (x.from ?? "").trim().toLowerCase();
  if (!REPLY_TEST_ALLOWLIST.includes(from)) return "TEST mode: sender is not on the reply-draft allow-list";
  if (x.jobSources.some((s) => s !== "qa_test")) return "TEST mode: only qa_test jobs get reply drafts";
  if (x.partnerIsTest === false) return "TEST mode: only TEST partners get reply drafts";
  return null;
}

/** Whether this draft WOULD be sent automatically if Jo had switched its type on. Pure decision only — nothing sends. */
export function wouldAutoSend(d: Pick<ReplyDraft, "type" | "checkBeforeSending">, autoSend: Readonly<Record<ReplyType, boolean>> = REPLY_AUTO_SEND): boolean {
  return !!autoSend[d.type] && !d.checkBeforeSending;
}

/** Graph write paths the drafter may call. Anything that sends (send, sendMail, reply, replyAll, forward) is refused. */
export function assertDraftOnlyRequest(method: "POST" | "PATCH", path: string): void {
  const p = path.split("?")[0]!;
  if (/\/(send|sendMail|reply|replyAll|forward)$/i.test(p) || /\/(send|sendMail)(\/|$)/i.test(p)) throw new Error("Refused: the reply drafter never sends mail.");
  const ok = method === "POST"
    ? /^\/users\/[^/]+\/messages(\/[^/]+\/createReply)?$/.test(p)
    : /^\/users\/[^/]+\/messages\/[^/]+$/.test(p);
  if (!ok) throw new Error(`Refused: ${method} ${p} is not a draft-only Outlook request.`);
}

/** Decision 386: the ONE non-draft Outlook write — move a single message to the well-known Archive folder after its
 *  automatic owner reply was sent (behind OUTLOOK_ARCHIVE_AFTER_REPLY_ENABLED). Anything else is refused: no send, no
 *  delete, no other folder, no other message operation. */
export const ARCHIVE_FOLDER = "archive";
export function assertArchiveMoveRequest(method: string, path: string, body: unknown): void {
  const p = path.split("?")[0]!;
  if (method !== "POST" || p !== path || !/^\/users\/[^/]+\/messages\/[^/]+\/move$/.test(p)) throw new Error(`Refused: ${method} ${path} is not a move-to-Archive Outlook request.`);
  const b = body as { destinationId?: unknown } | null;
  if (!b || Object.keys(b).length !== 1 || b.destinationId !== ARCHIVE_FOLDER) throw new Error("Refused: a message may only be moved to the Archive folder.");
}

/** Outlook categories put on the draft (visible to the office in Outlook, never in the message text). */
export function draftCategories(d: Pick<ReplyDraft, "type" | "checkBeforeSending">): string[] {
  return ["Portal draft", `Portal: ${REPLY_TYPE_LABEL[d.type]}`, ...(d.checkBeforeSending ? [CHECK_BEFORE_SENDING] : [])];
}

/** Sentences in the reply body (between the greeting and the sign-off) — used by tests to hold the 2–5 rule. */
export function bodySentences(text: string): number {
  const body = text.split("\n\n").slice(1, -1).join(" ");
  return body.split(/(?<!\bincl\.)(?<=[.!?])\s+(?=[A-Z$])/).map((s) => s.trim()).filter(Boolean).length;
}
