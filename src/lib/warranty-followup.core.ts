// Decision 363 (Jo 25 Oct 2026): a manufacturer warranty PDF that was not on file when the All done email / completion
// pack went out is sent to the owner on its own once it is added, so the owner holds it and the AP auto-signature
// (decision 271) can proceed. ONE email per job (O73 "Your insulation warranty", PDF attached), key
// `warranty-followup:v1:{job}`, then `warranty_copy_provided` is recorded with via "warranty_followup".
// Wording APPROVED by Jo 25 Oct 2026, decision 375 (design docs/templates/mjml/owner_O73.mjml):
// WARRANTY_FOLLOWUP_APPROVED stays false until Jo approves it — real owners get nothing and nothing is recorded while it is
// false; TEST (qa_test) jobs use test-send. PURE: rules, key and the renderer. No I/O.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { deliveryFromEvents, retryWaitBlocker, unknownSendOpen, type DeliveryState, type SendEvent, type SendEventNames } from "./send-outcome.core";

export const WARRANTY_FOLLOWUP_APPROVED = true as boolean; // Jo approved O73 as drafted, 25 Oct 2026 (decision 375)
export const WARRANTY_FOLLOWUP_TEMPLATE_CODE = "O73";
export const WARRANTY_FOLLOWUP_PURPOSE = "warranty_followup";
// Review R04 (audit F16): the old single marker was written BEFORE delivery, so a failed send consumed it for good and
// `warranty_copy_provided` was never recorded. Each attempt now has a reservation and exactly one outcome:
//   ATTEMPT  — written before the send (key, attempt number) so an interrupted send is never silently repeated;
//   SENT     — the email service ACCEPTED it (details.confirmed = true); then `warranty_copy_provided` is recorded;
//   FAILED   — a DEFINITE failure (refused, blocked, or never handed over): a later tick retries with the SAME provider
//              idempotency key, after a growing wait (1h, 2h, 4h … max 24h);
//   UNKNOWN  — no clear answer (timeout, 5xx, lost connection, an attempt with no recorded outcome): NEVER resent; the
//              office sees one Needs me row (`warrantyFollowupUnknownOpen`) until the copy is recorded.
// A `warranty_followup_sent` row WITHOUT details.confirmed is the pre-R04 marker (written before delivery): treated as an
// attempt with no recorded outcome — the email log decides it, else it is UNKNOWN.
export const WARRANTY_FOLLOWUP_ATTEMPT_EVENT = "warranty_followup_attempt";
/** Confirmed delivery (details.confirmed = true). Before review R04 the same name was written BEFORE sending. */
export const WARRANTY_FOLLOWUP_SENT_EVENT = "warranty_followup_sent";
export const WARRANTY_FOLLOWUP_FAILED_EVENT = "warranty_followup_failed";
export const WARRANTY_FOLLOWUP_UNKNOWN_EVENT = "warranty_followup_unknown";
export const WARRANTY_FOLLOWUP_EVENTS = [WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_SENT_EVENT, WARRANTY_FOLLOWUP_FAILED_EVENT, WARRANTY_FOLLOWUP_UNKNOWN_EVENT] as const;

/** Recorded by the completion pack when an installed product's warranty PDF was not on file. */
export const PRODUCT_WARRANTY_MISSING_EVENT = "product_warranty_missing";
export const warrantyFollowupKey = (jobId: string) => `warranty-followup:v1:${jobId}`;

export type WarrantyFollowupEvent = SendEvent;
export type WarrantyFollowupDelivery = DeliveryState;
export const WARRANTY_FOLLOWUP_EVENT_NAMES: SendEventNames = { attempt: WARRANTY_FOLLOWUP_ATTEMPT_EVENT, sent: WARRANTY_FOLLOWUP_SENT_EVENT, failed: WARRANTY_FOLLOWUP_FAILED_EVENT, unknown: WARRANTY_FOLLOWUP_UNKNOWN_EVENT, sentNeedsConfirmed: true };

/** Where the follow-up stands, from its own events (any order). Pure. */
export const warrantyFollowupDelivery = (events: readonly WarrantyFollowupEvent[]): WarrantyFollowupDelivery => deliveryFromEvents(events, WARRANTY_FOLLOWUP_EVENT_NAMES);

/** Needs me (review R04): ONE open row per job while a follow-up outcome is unknown and no warranty copy is recorded. */
export const WARRANTY_FOLLOWUP_UNKNOWN_LINE = "Warranty email · no clear answer from the email service · not resent · check the email service and the owner";
export function warrantyFollowupUnknownOpen(events: readonly WarrantyFollowupEvent[], copyProvided: boolean): { at: string; text: string } | null {
  const o = unknownSendOpen(events, WARRANTY_FOLLOWUP_EVENT_NAMES, copyProvided);
  return o ? { at: o.at, text: WARRANTY_FOLLOWUP_UNKNOWN_LINE } : null;
}

export type WarrantyFollowupFacts = {
  installCompleted: boolean; deleted: boolean;
  /** A `product_warranty_missing` event exists (the pack went out without a PDF). */
  missingRecorded: boolean;
  /** `warranty_copy_provided` already recorded (by O44, O47 or an earlier follow-up). */
  provided: boolean;
  /** The follow-up was confirmed delivered for this job (review R04: only after the email service accepted it). */
  alreadySent: boolean;
  /** Installed products, and whether every one now has its PDF on file. */
  products: string[]; allOnFile: boolean;
  /** Review R04: earlier attempts (`warrantyFollowupDelivery`) and the time now — absent = never tried. */
  delivery?: WarrantyFollowupDelivery; now?: string;
};

/** Why nothing happens now, or null when the follow-up email is due. */
export function warrantyFollowupBlocker(f: WarrantyFollowupFacts): string | null {
  if (f.deleted) return "job deleted";
  if (!f.installCompleted) return "install not recorded complete";
  if (!f.missingRecorded) return "no warranty was missing";
  if (f.provided) return "warranty copy already provided";
  if (f.alreadySent || f.delivery?.state === "delivered") return "follow-up already sent";
  if (f.delivery?.state === "unknown") return "follow-up delivery outcome unknown — not resent; office to check";
  if (f.delivery?.state === "pending") return "follow-up attempt has no recorded outcome — not resent; office to check";
  if (!f.products.length) return "installed product not known";
  if (!f.allOnFile) return "warranty PDF still not on file";
  return f.delivery ? retryWaitBlocker(f.delivery, f.now ?? new Date().toISOString()) : null;
}

export type WarrantyFollowupEmailInput = { firstName: string | null; products: string[]; unsubscribeUrl: string | null; test?: boolean };

/** O73 wording (decision 375; design docs/templates/mjml/owner_O73.mjml): subject "Your insulation warranty", two plain
 *  sentences, a short "Any questions?" line, the PDF attached. */
export function warrantyFollowupCopy(products: string[]): { subject: string; lines: string[] } {
  const named = products.length ? `the ${products.join(" and ")} insulation` : "the insulation";
  return {
    subject: "Your insulation warranty",
    lines: [
      `Attached is the manufacturer's warranty for ${named} we installed in your ceiling.`,
      "We couldn't include it with your earlier email, so please keep this copy with your other job papers.",
      "Any questions? Just reply to this email.",
    ],
  };
}

export function renderWarrantyFollowupEmail(i: WarrantyFollowupEmailInput): { subject: string; html: string; text: string } {
  const first = K.cleanName(i.firstName) ?? "there";
  const c = warrantyFollowupCopy(i.products);
  const preview = `The manufacturer's warranty for your ${i.products.length ? `${i.products.join(" and ")} ` : ""}insulation is attached.`;
  const main = c.lines.slice(0, -1);
  const last = c.lines[c.lines.length - 1]!;
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${esc(`Hi ${first},`)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(c.subject)}</mj-text>${main.map((l) => `<mj-text>${esc(l)}</mj-text>`).join("")}<mj-text mj-class="small" padding="4px 12px 0">${esc(last)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject: c.subject, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([`Hi ${first},`, "", c.subject, "", c.lines.join("\n\n")], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject: c.subject, html, text };
}
