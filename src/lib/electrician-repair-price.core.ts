// Task 9 (Jo 28 Oct 2026, spec rule 3): the electrician BUSINESS OWNER prices the repair work in the portal, the same way
// installers price their jobs (decisions 278/288/289). When the A3 safety check is completed with repair work and no price,
// the owner of the electrician business on the job gets ONE text with a link to the "Your price" card on that job
// (`/field/{jobId}#price`). They enter the total repair price inc GST; the ticked work list from the form is shown
// read-only. The office can enter it too. Staff never see the card or the price. The price is kept as the append-only
// `electrician_repair_price_set` workflow event (latest wins, tied to its A3 form) and `fixesPriceSource` reads it FIRST;
// the form's own price is only the fallback for old forms. Jo removes the price question from the Mitti form once this
// is live. PURE: validation, the event read, the link decision, key, link and wording. No I/O.
import { parseFixesPrice } from "./fixes-price.core";
import { fixesWorkWithOnsite } from "./official-short.core";
import { PRICE_CARD_ANCHOR } from "./boss-price-link.core";

export const REPAIR_PRICE_EVENT = "electrician_repair_price_set" as const;
/** Recorded once per job + A3 form BEFORE anything is sent (details: { key, audit_id, completed_at, business_id, to }). */
export const REPAIR_PRICE_LINK_EVENT = "repair_price_link_sent" as const;
/** The real-sender message type (sms.core SMS_MESSAGE_TYPES); its own switch, absent = OFF. */
export const REPAIR_PRICE_SMS_TYPE = "repair_price_link" as const;

/** The price card's wording, exactly as Jo gave it (28 Oct 2026, spec rule 3). The office sees the same card under its own title. */
export const REPAIR_PRICE_CARD = {
  title: "Price the repairs",
  officeTitle: "Electrician's repair price",
  listHeading: "Repairs from the safety check",
  priceLabel: "Your price for all of these (inc GST)",
  saveButton: "Save price",
  yourPrice: "Your price:",
  change: "Change",
  extrasHeading: "Extra items to price",
} as const;

export const REPAIR_PRICE_ISSUE = "Enter your total price for all the repair work, inc GST (more than $0).";
export const REPAIR_PRICE_LOCKED = "The repair quote has already gone to the homeowner. To change it, contact the office.";
export const REPAIR_PRICE_STAGE_REFUSED = "The repair price can only be set after the safety check and before the homeowner has the repair quote.";
/** Held-draft reason when the quote could not be rebuilt after the price changed (fixes-quote-release refuses it). */
export const REPAIR_PRICE_REBUILD_FAILED = "The repair price changed but the quote could not be rebuilt. Rebuild the quote before sending.";
/** Send refused: the draft was built from a different electrician price than the one now on the job. */
export const REPAIR_PRICE_STALE = "The electrician's repair price has changed since this quote was built. Rebuild the quote, then send it.";
/** Send refused: an extra item was priced, changed or removed since the draft was built (Jo 28 Oct: extras are lines). */
export const REPAIR_EXTRAS_STALE = "An extra item was priced or changed since this quote was built. Rebuild the quote, then send it.";
export const REPAIR_PRICE_NO_WORK = "The safety check form doesn't list any repair work.";

/** Stages where the owner or office may set the repair total: from the safety check until the repair quote goes out. */
export const REPAIR_PRICE_STAGES: readonly string[] = ["piesa_scheduled", "assessment_booked", "assessment_booking", "assessment_complete", "piesa_complete", "electrical_variation_pending", "rectification_required"];

/** The A3 says repair work is needed and ticks what it is (the price question's own condition). */
export function repairPriceNeeded(short: Record<string, unknown> | null | undefined): boolean {
  if (!short) return false;
  return /^\s*yes\b/i.test(String(short["rectificationNeeded"] ?? "")) && fixesWorkWithOnsite(short).length > 0;
}

/** One clear positive amount (same reading as the old form's price), else the plain issue. */
export function validateRepairPrice(raw: unknown): { ok: true; price: number } | { ok: false; issue: string } {
  const price = parseFixesPrice(raw);
  return price == null ? { ok: false, issue: REPAIR_PRICE_ISSUE } : { ok: true, price };
}

/** A stored event's price, only when it belongs to this A3 form (a re-done safety check needs a new price). */
export function repairPriceFromEvent(details: unknown, auditId: string | null | undefined): number | null {
  if (!auditId || !details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (d["audit_id"] !== auditId) return null;
  return parseFixesPrice(d["price_inc_gst"]);
}

/** One text per job and A3 form (a re-sync or a later sync never texts again; a re-done PIESA has a new form). */
export const repairPriceLinkKey = (jobId: string, auditId: string) => `repair-price-link:v1:${jobId}:${auditId}`;
/** The authenticated job page, scrolled to the "Your price" card. */
export const repairPriceLink = (base: string, jobId: string) => `${base.replace(/\/+$/, "")}/field/${jobId}#${PRICE_CARD_ANCHOR}`;

/** Task 9 wording (for Jo to approve before the type's switch is turned on). The sender adds "Home Insulation Victoria: ". */
export function repairPriceLinkText(f: { address: string | null; link: string }): string {
  return `The safety check at ${f.address?.trim() || "the property"} needs electrical repairs. Enter your price for the repair work: ${f.link}`;
}

export type RepairPriceLinkFacts = {
  deleted: boolean;
  piesaCompleted: boolean;
  priceNeeded: boolean;
  /** A portal price for this A3 form exists, or the old form carries a usable price. */
  pricePresent: boolean;
  alreadySent: boolean;
  electricianAssigned: boolean;
};
/** Why no text goes now (null = send). Once per job + A3 form; never once the price is in. */
export function repairPriceLinkBlocker(f: RepairPriceLinkFacts): string | null {
  if (f.deleted) return "job closed";
  if (!f.piesaCompleted) return "PIESA not completed in Mitti";
  if (!f.priceNeeded) return "no repair work on the safety check";
  if (f.pricePresent) return "price already entered";
  if (f.alreadySent) return "already texted";
  if (!f.electricianAssigned) return "no electrician assigned";
  return null;
}
