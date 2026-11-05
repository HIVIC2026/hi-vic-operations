// Installer fixes deep, Task 6 (Jo 5 Nov 2026): a discount on a quote that has already gone to the owner of an
// installer's OWN customer job. Pure rules only — the amount checks, the new line and the new totals. The sent quote is
// never changed; the discount becomes a NEW quote version held for the office ("Quotes to check"). Persistence in
// installer-discount.server.ts. Nothing here mentions the owner's payment steps.
import { quoteAdjustmentDiscount } from "./estimate.core";

export const INSTALLER_DISCOUNT_CODE = "INSTALLER_DISCOUNT";
/** Append-only history: the installer offered a discount; details = { quote_id, source_quote_id, amount_inc_gst, note, requested_by }. */
export const INSTALLER_DISCOUNT_EVENT = "installer_discount_requested";
/** Recorded when the office sends the discount version and the old sent quote is replaced. */
export const INSTALLER_DISCOUNT_REPLACED_EVENT = "installer_discount_quote_replaced";
export const DISCOUNT_QUOTE_LABEL = "Installer's quote with discount";
/** The only hold reason the office Send treats as "nothing missing" (office-quote-review.core strips it). */
export const DISCOUNT_HOLD_REASON = "Waiting for office review before sending";

// Plain wording (installer screen). DRAFT until Jo has seen it.
export const DISCOUNT_SAVED_LINE = "Discount sent to Home Insulation Victoria to check. The owner's quote doesn't change until we send the new one.";
export const DISCOUNT_ACTION_LABEL = "Offer a discount";
export const DISCOUNT_REFUSED_ROLE = "Only the business owner or the office can offer a discount.";
export const DISCOUNT_NOT_OWN_JOB = "A discount can only be offered on your own customers' jobs.";
export const DISCOUNT_NOT_SENT = "A discount can only be offered once the quote has gone to the owner.";
export const DISCOUNT_ACCEPTED = "The owner has already accepted the quote, so it can't be discounted.";
export const DISCOUNT_EXPIRED = "The quote has expired. Ask Home Insulation Victoria for a new quote instead.";
export const DISCOUNT_ALREADY_PENDING = "A discount is already with Home Insulation Victoria to check.";
export const DISCOUNT_PRICE_CHANGE_WAITING = "Your new price is with Home Insulation Victoria first. Offer a discount once the new quote has gone to the owner.";
export const DISCOUNT_SOURCE_ACCEPTED = "The owner accepted the earlier quote while this discount was waiting — nothing sent.";

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "$200" for whole dollars, "$150.50" otherwise — the line the owner reads. */
const shortMoney = (n: number) => (Number.isInteger(n) ? `$${n.toLocaleString("en-AU")}` : money(n));

export const discountLineDescription = (amountIncGst: number) => `Discount −${shortMoney(amountIncGst)}`;

export type DiscountQuoteFacts = { subtotal_inc_gst: number | string; veec_discount_inc_gst: number | string; minimumCopay: number; veecValue: number };

/** What the quote already takes off (Review 1 finding 4): the sum of its INSTALLER_DISCOUNT lines, as a positive amount
 *  (a sent quote can itself be a discount version; a second discount comes off what is left). */
export function existingDiscountIncGst(lines: readonly { code: string | null; line_total_inc_gst: number | string }[]): number {
  return r2(lines.filter((l) => l.code === INSTALLER_DISCOUNT_CODE).reduce((a, l) => a - Number(l.line_total_inc_gst), 0));
}

/** Every reason the amount can't be used (empty = fine). ≤ the installer's price less any discount already on the quote;
 *  the owner's $200 minimum payment rule (quoteAdjustmentDiscount: rebate ≤ subtotal − minimum) still holds after the
 *  discount; whole cents only. */
export function discountErrors(amountIncGst: number, installerPriceIncGst: number, quote: DiscountQuoteFacts, alreadyOffIncGst = 0): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(amountIncGst) || amountIncGst <= 0) return ["Enter the discount amount (inc GST)."];
  if (Math.abs(amountIncGst * 100 - Math.round(amountIncGst * 100)) > 1e-6) return ["The discount must be whole cents."];
  const fullPrice = Number(installerPriceIncGst);
  if (!(fullPrice > 0)) return ["Your price line could not be found on the quote."];
  const already = Math.max(0, r2(Number(alreadyOffIncGst) || 0));
  const price = r2(fullPrice - already);
  if (amountIncGst > price + 1e-9) errors.push(already > 0 ? `The discount can't be more than what's left of your price (${money(price)} after the ${money(already)} already taken off).` : `The discount can't be more than your price (${money(price)}).`);
  const subtotal = r2(Number(quote.subtotal_inc_gst) - amountIncGst);
  const rebate = r2(Number(quote.veec_discount_inc_gst));
  const check = quoteAdjustmentDiscount(rebate, subtotal, quote.veecValue, quote.minimumCopay, true);
  if (!check.ok) errors.push(check.error);
  else if (check.reducedForMin) {
    const most = Math.max(0, r2(Number(quote.subtotal_inc_gst) - rebate - quote.minimumCopay));
    errors.push(`The discount would take the owner's payment below the ${shortMoney(quote.minimumCopay)} minimum. The most you can take off is ${money(most)}.`);
  }
  return errors;
}

export type QuoteLineIn = { code: string | null; description: string; quantity: number | string; unit: string; unit_price_inc_gst: number | string; line_total_inc_gst: number | string; is_other?: boolean | null; explanation?: string | null; sort: number; id?: string; quote_id?: string };
export type QuoteLineOut = { code: string | null; description: string; quantity: number; unit: string; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: boolean; explanation: string | null; sort: number };

/** The sent quote's lines with "Discount −$X" straight under the installer's price line; sorts renumbered 0..n; row ids
 *  dropped. A quote that already carries a discount gets ONE combined line (the two amounts added), so the owner's rows
 *  (own-customer-price.core: at most one Discount row) and the installer's price both keep one plain figure. */
export function discountedLines(lines: QuoteLineIn[], amountIncGst: number): QuoteLineOut[] {
  const amount = r2(amountIncGst + existingDiscountIncGst(lines));
  const copy = (l: QuoteLineIn): QuoteLineOut => ({ code: l.code, description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_price_inc_gst: Number(l.unit_price_inc_gst), line_total_inc_gst: Number(l.line_total_inc_gst), is_other: !!l.is_other, explanation: l.explanation ?? null, sort: l.sort });
  const sorted = lines.filter((l) => l.code !== INSTALLER_DISCOUNT_CODE).map((l, n) => [l, n] as const).sort((a, b) => a[0].sort - b[0].sort || a[1] - b[1]).map(([l]) => copy(l));
  const at = sorted.findIndex((l) => l.code === "INSTALLER_PRICE");
  const discount: QuoteLineOut = { code: INSTALLER_DISCOUNT_CODE, description: discountLineDescription(amount), quantity: 1, unit: "flat", unit_price_inc_gst: -amount, line_total_inc_gst: -amount, is_other: false, explanation: null, sort: 0 };
  const out = at >= 0 ? [...sorted.slice(0, at + 1), discount, ...sorted.slice(at + 1)] : [...sorted, discount];
  return out.map((l, i) => ({ ...l, sort: i }));
}

/** New totals: the discount comes off the subtotal (GST re-derived at 10%); the rebate stays as it was. */
export function discountedTotals(quote: { subtotal_inc_gst: number | string; veec_discount_inc_gst: number | string }, amountIncGst: number) {
  const subtotal = r2(Number(quote.subtotal_inc_gst) - amountIncGst);
  const rebate = r2(Number(quote.veec_discount_inc_gst));
  return { subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / 1.1), veec_discount_inc_gst: rebate, customer_total_inc_gst: r2(subtotal - rebate) };
}
