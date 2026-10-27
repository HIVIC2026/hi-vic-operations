// Decision 238 (Jo, 24 Oct 2026): automatic follow-up for estimate-only leads. PURE: schedule, keys, stop rules,
// close decision and the three kit emails. Nothing here reads or sends; estimate-followup.server.ts does the I/O.
//
// An estimate-only lead is a job at stage `preliminary_estimate_ready` whose Save my spot estimate email went out
// (office_enquiry_index.spot_offered) and whose owner has NOT saved a spot. The owner gets ONE short reminder email on
// day 2, day 7 and day 21 after that estimate email (each re-using the O1 price box and the "Save my free spot" button),
// then the estimate is closed automatically (stage cancelled, reason "no response after estimate", history kept,
// reopen possible) one week after the day-21 email — unless the owner saved a spot, replied, opted out or the job
// moved stage in the meantime. One workflow event per send and per auto-close.
//
// Wording APPROVED (decision 242, reconfirmed decision 357, Jo 25 Oct 2026): designs filed under docs/templates/owner/
// (O66 day 2, O67 day 7, O68 day 21). Real owners still need `customer_comms_enabled` (and consent); if the flag were
// ever false, real owners get nothing and nothing is closed (a close needs a recorded day-21 send); TEST (qa_test) jobs
// use test-send so the flow can be checked.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { mjHeadline, mjRebateAndPrice, mjSmallEnd, mjSubSection, rebateAndPriceText } from "./jo-outcome-email.core";

export const ESTIMATE_FOLLOWUP_APPROVED = true as boolean; // Decision 388: paused 25 Oct 2026, reworded spot-only; Jo re-approved O66–O68 the same day ("Approve, use /homeowner" for the day-21 come-back line)

export type EstimateFollowupStep = "day_2" | "day_7" | "day_21";
export const ESTIMATE_FOLLOWUP_STEPS: readonly EstimateFollowupStep[] = ["day_2", "day_7", "day_21"];
/** Days after the estimate email each reminder becomes due; a reminder is skipped once the next one is due. */
export const ESTIMATE_FOLLOWUP_SCHEDULE: Record<EstimateFollowupStep, number> = { day_2: 2, day_7: 7, day_21: 21 };
/** Days after the day-21 email before the estimate is closed. */
export const ESTIMATE_FOLLOWUP_CLOSE_AFTER_DAYS = 7;

/** Workflow event per reminder sent (details.step), and the recorded reason on the job when it is closed. */
export const ESTIMATE_FOLLOWUP_EVENT = "estimate_followup_sent";
/** Workflow event when a due reminder could not be prepared for this job (figures or link missing); counts as that step done. */
export const ESTIMATE_FOLLOWUP_NOT_SENT_EVENT = "estimate_followup_not_sent";
/** F09: the send RESULT, recorded after the send (details.step, details.sent). Only a sent day-21 starts the close. */
export const ESTIMATE_FOLLOWUP_RESULT_EVENT = "estimate_followup_result";
/** The auto-close is a `stage_changed` event to cancelled with this reason (jobs.cancelled_reason), like the other closers. */
export const ESTIMATE_FOLLOWUP_CLOSE_REASON = "no response after estimate";
export const ESTIMATE_FOLLOWUP_CLOSE_SOURCE = "estimate_followup";
export const ESTIMATE_FOLLOWUP_STAGE = "preliminary_estimate_ready";

export const estimateFollowupPurpose = (step: EstimateFollowupStep) => `estimate_followup_${step}`;
export const estimateFollowupKey = (jobId: string, step: EstimateFollowupStep) => `estimate-followup:v1:${jobId}:${step}`;

export const TEMPLATE_CODE: Record<EstimateFollowupStep, string> = { day_2: "O66", day_7: "O67", day_21: "O68" };

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(iso);

export type EstimateFollowupFacts = {
  stage: string | null; source: string | null; deletedAt: string | null; qaArchivedAt: string | null;
  /** When the Save my spot estimate email was sent (customer_email_sends.sent_at); null = never offered. */
  estimateEmailedAt: string | null;
  spotSavedAt: string | null;
  /** Campaign opt-out or email unsubscribe. */
  optedOut: boolean;
  /** Any inbound owner message (email/text/portal) on the job since the estimate email. */
  repliedAt: string | null;
  ownerEmail: string | null;
  /** Steps already recorded (sent or not-sent events), with when the send event was recorded. */
  done: { step: EstimateFollowupStep; at: string }[];
  /** F09: steps whose email actually went out (result event recorded after the send with sent = true). */
  sent?: { step: EstimateFollowupStep; at: string }[];
};

export const STOP = {
  moved: "Job moved on from the estimate stage",
  deleted: "Job deleted",
  archived: "Job archived",
  not_offered: "No estimate email has been sent",
  saved: "Owner saved a spot",
  opted_out: "Owner opted out",
  replied: "Owner replied",
  no_email: "No owner email address",
} as const;

/** Why nothing further happens for this job, or null when the follow-up is still running. */
export function estimateFollowupStop(f: EstimateFollowupFacts): string | null {
  if (f.deletedAt) return STOP.deleted;
  if (f.qaArchivedAt) return STOP.archived;
  if (f.stage !== ESTIMATE_FOLLOWUP_STAGE) return STOP.moved;
  if (!f.estimateEmailedAt) return STOP.not_offered;
  if (f.spotSavedAt) return STOP.saved;
  if (f.optedOut) return STOP.opted_out;
  if (f.repliedAt && t(f.repliedAt) >= t(f.estimateEmailedAt)) return STOP.replied;
  if (!f.ownerEmail?.trim()) return STOP.no_email;
  return null;
}

export type EstimateFollowupDecision =
  | { kind: "send"; step: EstimateFollowupStep }
  | { kind: "close" }
  | { kind: "wait"; until: string }
  | { kind: "stop"; reason: string };

/**
 * One decision per tick. A reminder is due from its day until the next reminder's day; a reminder whose window has
 * passed is never sent late (an old lead never gets three emails in a row). The close is due one week after the
 * day-21 email was actually sent — never from the calendar alone, so a held wording can never close a lead unwarned.
 */
export function decideEstimateFollowup(f: EstimateFollowupFacts, nowIso: string): EstimateFollowupDecision {
  const stop = estimateFollowupStop(f);
  if (stop) return { kind: "stop", reason: stop };
  const base = t(f.estimateEmailedAt!), now = t(nowIso);
  const doneSteps = new Set(f.done.map((d) => d.step));
  for (let i = 0; i < ESTIMATE_FOLLOWUP_STEPS.length; i++) {
    const step = ESTIMATE_FOLLOWUP_STEPS[i]!, next = ESTIMATE_FOLLOWUP_STEPS[i + 1];
    const from = base + ESTIMATE_FOLLOWUP_SCHEDULE[step] * DAY;
    const until = next ? base + ESTIMATE_FOLLOWUP_SCHEDULE[next] * DAY : Infinity;
    if (now < from) return { kind: "wait", until: new Date(from).toISOString() };
    if (now < until && !doneSteps.has(step)) return { kind: "send", step };
  }
  // F09: only a day-21 email that actually went out starts the close — a not-prepared, held or failed send never does.
  const last = (f.sent ?? []).find((d) => d.step === "day_21");
  if (!last) return { kind: "stop", reason: "Day-21 reminder was never sent, so the estimate is not closed automatically" };
  const closeAt = t(last.at) + ESTIMATE_FOLLOWUP_CLOSE_AFTER_DAYS * DAY;
  return now >= closeAt ? { kind: "close" } : { kind: "wait", until: new Date(closeAt).toISOString() };
}

// ---------------------------------------------------------------------------
// Emails (O66 / O67 / O68 — re-use the O1 rebate and price boxes and Save my spot button)
// ---------------------------------------------------------------------------
export type EstimateFollowupEmailInput = {
  step: EstimateFollowupStep;
  firstName: string | null;
  /** Current estimate figures: VEU rebate, what the owner pays, full price before the rebate. */
  rebate: number; price: number; fullPrice: number;
  /** "Based on what you told us: 137 m² ceiling, no existing insulation." (jo-outcome-email basisLine). */
  basis: string;
  /** Owner said there is some insulation already: price box labels say "potential" / "if eligible", as in O2. */
  someInsulation?: boolean;
  saveUrl: string;
  calculatorUrl: string | null;
  unsubscribeUrl: string | null;
  test?: boolean;
};

const SAVE_TITLE = "Save your spot – it's free";
const SAVE_LABEL = "Save my free spot";
const REPLY = "Questions? Just reply to this email.";
/** Day 21's come-back page, shown as a tappable link in the email. */
const COME_BACK_URL = "https://homeinsulationvictoria.com.au/homeowner";
const COME_BACK_LABEL = "homeinsulationvictoria.com.au/homeowner";

type Copy = { subject: string; preview: string; intro: string; saveTitle: string; save: string; after: string | null; closing: string };

/** The three wordings (decision 388 spot-only, re-approved by Jo 25 Oct 2026; MJML refresh 27 Oct 2026:
 *  docs/templates/mjml/owner_O66–O68). */
export function estimateFollowupCopy(step: EstimateFollowupStep, first: string, rebate: string, price?: string): Copy {
  switch (step) {
    case "day_2": return {
      subject: `${first}, your ${rebate} rebate spot is still open`,
      preview: price ? `Your price could be ${price} after the rebate. Saving your spot takes a few seconds.` : "Saving your spot takes a few seconds.",
      intro: `A couple of days ago we sent your ceiling insulation estimate. Nothing has changed: the ${rebate} Victorian Energy Upgrades rebate is still available and your spot is still open.`,
      saveTitle: SAVE_TITLE,
      save: "Thousands of Victorians have registered. Spots are released in the order they were saved. It takes a few seconds. No payment, no obligation.",
      after: null,
      closing: REPLY,
    };
    case "day_7": return {
      subject: `${first}, still thinking about your ceiling insulation?`,
      preview: "Nothing is locked in until you've seen your exact price and agreed to it.",
      intro: `It's been a week since we sent your estimate, so here it is again. The ${rebate} rebate comes straight off the price. Nothing is locked in until you've seen your exact price and agreed to it.`,
      saveTitle: SAVE_TITLE,
      save: "Save your spot to keep your place in line. Spots are released in the order they were saved, and we'll be in touch when yours is released. No payment, no obligation.",
      after: null,
      closing: REPLY,
    };
    case "day_21": return {
      subject: `${first}, we'll close your estimate in a week`,
      preview: `Save your spot now to stay on the list with your ${rebate} rebate.`,
      intro: "We sent your ceiling insulation estimate three weeks ago and haven't heard back. So we'll close it in a week to keep our list accurate.",
      saveTitle: "Want to keep your spot? Save it now",
      save: `Save your spot and you stay on the list with your ${rebate} rebate. No payment, no obligation.`,
      after: `If now isn't the right time, that's fine. You can come back any time: reply to this email or visit ${COME_BACK_LABEL} and we'll pick up where we left off.`,
      closing: REPLY,
    };
  }
}

export function renderEstimateFollowupEmail(i: EstimateFollowupEmailInput): { subject: string; html: string; text: string } {
  const first = K.cleanName(i.firstName) ?? "there";
  const rebate = K.whole(i.rebate), price = K.whole(i.price);
  const c = estimateFollowupCopy(i.step, first, rebate, price);
  const some = i.someInsulation === true;
  const box = { rebateLabel: some ? "Your potential rebate" : "Your estimated rebate", rebate: i.rebate, priceLabel: some ? "Your cost if eligible" : "You pay after the rebate", price: i.price, fullPrice: i.fullPrice, basis: i.basis, calculatorUrl: i.calculatorUrl };
  const afterHtml = c.after ? K.esc(c.after).replace(COME_BACK_LABEL, `<a href="${COME_BACK_URL}" style="color:#3C51C4;font-weight:700;">${COME_BACK_LABEL}</a>`) : null;
  const body = [
    mjHeadline(c.subject, c.intro),
    mjRebateAndPrice(box),
    mjSubSection(c.saveTitle, c.save, { href: i.saveUrl, label: SAVE_LABEL }),
    afterHtml ? `<mj-section><mj-column><mj-text>${afterHtml}</mj-text></mj-column></mj-section>` : "",
    mjSmallEnd(K.esc(c.closing), "4px 12px 0"),
  ].filter(Boolean).join("\n");
  const html = mjEmail({ subject: c.subject, preview: c.preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([
    c.subject, "", c.intro, "",
    ...rebateAndPriceText(box), "",
    c.saveTitle.toUpperCase(), c.save, `${SAVE_LABEL}: ${i.saveUrl}`, "",
    c.after, c.after ? "" : null, c.closing,
  ], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject: c.subject, html, text };
}
