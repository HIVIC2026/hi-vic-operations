// Photo-quote installers Part 2 (Jo 5 Nov 2026): a "From photos" installer adds their OWN customer with the photo quote in
// one press. The live quote on Add a job is built ONLY by `buildOwnCustomerQuoteDraft` (the same builder the issued quote
// uses), from the same draft input the server builds — no second pricing formula. PURE.
import { applyMittiProduct, applyMittiRemoval, buildOwnCustomerQuoteDraft, type OwnCustomerDraftInput } from "./mitti-installer-quote.core";
import { PRICE_INCLUDED_OPTIONS, PRICE_ISSUES, priceEntriesFromRecord, validateInstallerPrice, type InstallerPriceRecord } from "./installer-price.core";
import { quotedPriceFromEntries } from "./installer-led.core";
import { insulationProduct } from "./insulation-product.core";
import { PHOTO_QUOTE_WORDS, photoQuoteProblems, sqm1, type PhotoQuoteInput } from "./photo-quote.core";

export const OWN_PHOTO_QUOTE_WORDS = {
  price: "Your price (inc GST, install + removal)",
  /** DRAFT. The $ figures are the actual amounts, never literals. */
  feesLine: (apFee: number, piesa: number) => `We add our ${money(apFee)} AP management fee and the ${money(piesa)} PIESA fee to your price.`,
  submit: "Add the job and send the quote",
  noPiesa: "Set this installer's PIESA price first",
  priceMissing: "Enter your price",
  overR2: "Over R2 isn't eligible for the rebate.",
  /** DRAFT (Jo 5 Nov 16:44: sqm to remove above 0 needs the removal tick; 0 can't have it). */
  removalTick: `You've put sqm to remove, so tick "${PRICE_INCLUDED_OPTIONS[1]}".`,
  removalUntick: `Sqm to remove is 0, so untick "${PRICE_INCLUDED_OPTIONS[1]}".`,
  /** DRAFT (installer-facing, fix round). */
  changedAfterQuote: "This job's quote is already made, so the answers can't change here. Email us if something's wrong.",
  /** DRAFT (installer-facing, fix round): Add a job saved the job but the quote didn't go through. */
  failed: "The job is saved, but the quote didn't go through. Press Try again.",
  /** DRAFT (installer-facing, fix round): the quote was made but is waiting (a check held it, or the office sends it). */
  held: "Job added. The quote is made and waiting for the office to check it before it goes to the owner.",
} as const;

export function money(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Jo 5 Nov 16:44: the photo quote plus the SAME price inputs as the "Your price" card — price, the "What's included"
 *  ticks (`PRICE_INCLUDED_OPTIONS`) and "Other" words. The product is the photo quote's own product field. */
export type OwnPhotoQuoteInput = PhotoQuoteInput & { priceIncGst: number | null; included?: readonly string[] | null | undefined; includedOther?: string | null | undefined };
const REMOVAL_TICK = PRICE_INCLUDED_OPTIONS[1];
const ticked = (included: readonly string[] | null | undefined, option: string) => (included ?? []).some((x) => x.trim().toLowerCase() === option.toLowerCase());

/** Everything stopping "Add the job and send the quote": the photo quote checks, then the Your price card's own checks
 *  (validateInstallerPrice), then the removal tick against sqm to remove. */
export function ownPhotoQuoteProblems(i: OwnPhotoQuoteInput): string[] {
  // On Add a job there is no "Can't do this one": an over-R2 home just can't be added with a quote.
  const p = photoQuoteProblems(i).map((x) => (x === PHOTO_QUOTE_WORDS.overR2 ? OWN_PHOTO_QUOTE_WORDS.overR2 : x));
  const v = validateInstallerPrice({ priceIncGst: i.priceIncGst, included: [...(i.included ?? [])], includedOther: i.includedOther });
  for (const issue of v.issues) p.push(issue === PRICE_ISSUES.price ? OWN_PHOTO_QUOTE_WORDS.priceMissing : issue);
  const remove = sqm1(i.removeM2);
  if ((i.included ?? []).length && remove !== null) {
    if (remove > 0 && !ticked(i.included, REMOVAL_TICK)) p.push(OWN_PHOTO_QUOTE_WORDS.removalTick);
    if (remove === 0 && ticked(i.included, REMOVAL_TICK)) p.push(OWN_PHOTO_QUOTE_WORDS.removalUntick);
  }
  return p;
}

/** The `installer_price_set` record, built exactly as the "Your price" card builds it (validateInstallerPrice, with the
 *  removal answer from sqm to remove). Throws when the answers aren't valid (callers check the problems first). */
export function ownPhotoPriceRecord(i: OwnPhotoQuoteInput): InstallerPriceRecord {
  const v = validateInstallerPrice({ priceIncGst: i.priceIncGst, included: [...(i.included ?? [])], includedOther: i.includedOther, productOption: i.product, removalRequired: (sqm1(i.removeM2) ?? 0) > 0 });
  if (!v.ok || !v.record) throw new Error(v.issues.join(" ") || "Enter your price");
  return v.record;
}

/** Old claims (before 16:44) carried no ticks: the base tick, plus removal when there is removal. */
export function defaultPhotoTicks(removeM2: number | null): string[] {
  return (sqm1(removeM2) ?? 0) > 0 ? [PRICE_INCLUDED_OPTIONS[0], REMOVAL_TICK] : [PRICE_INCLUDED_OPTIONS[0]];
}

/** The draft input exactly as the Ready Check path reads a portal price: the record → its Mitti-labelled answers →
 *  quotedPriceFromEntries (installer-quote.server does the same for the photo quote). */
export function ownPhotoDraftInput(i: { record: InstallerPriceRecord; installM2: number; removeM2: number | null; wholeVeec: OwnCustomerDraftInput["wholeVeec"]; metropolitan: boolean | null; minCopay: number }): OwnCustomerDraftInput {
  return {
    price: quotedPriceFromEntries(priceEntriesFromRecord(i.record), (sqm1(i.removeM2) ?? 0) > 0),
    measuredM2: sqm1(i.installM2), wholeVeec: i.wholeVeec, separateLines: [],
    caps: { metropolitan: i.metropolitan, minCopay: i.minCopay },
  };
}

/** The insulation line's words, as on every other own-customer quote (the Ready Check path's applyMittiProduct +
 *  applyMittiRemoval): "Supply and install of {product} ceiling insulation – {m²} m² · Removal of existing insulation – {m²} m²". */
export function applyOwnPhotoWording<D extends { ready: boolean; blockers: string[]; lines: { code: string | null; description: string }[] }>(draft: D, i: { product: string | null; installM2: number; removeM2: number | null }): D {
  const product = insulationProduct(i.product);
  applyMittiProduct(draft, { ready: !!product, product, source: "mitti_form", reasons: product ? [] : ["Pick the product"] }, sqm1(i.installM2));
  applyMittiRemoval(draft, sqm1(i.removeM2));
  return draft;
}

/** The photo quote's own-customer draft: the one builder, then the shared wording. Preview and issued path alike. */
export function ownPhotoQuoteDraft(i: { record: InstallerPriceRecord; installM2: number; removeM2: number | null; product: string | null; wholeVeec: OwnCustomerDraftInput["wholeVeec"]; metropolitan: boolean | null; minCopay: number }, piesaIncGst: number | null) {
  return applyOwnPhotoWording(buildOwnCustomerQuoteDraft(ownPhotoDraftInput(i), piesaIncGst), i);
}

export type OwnPhotoPreview = { rows: OwnQuoteRow[]; ownerPays: number; feesLine: string } | { held: string };
/** The live quote under the price (Jo 5 Nov 16:44): the SAME rows as every other installer's own-customer quote —
 *  Insulation — {what it includes} · Home Insulation Victoria fee · Electrical safety check (PIESA) — charged by Home
 *  Insulation Victoria · Rebate · Your price — from the draft the issued quote is built from. */
export function ownPhotoQuotePreview(i: OwnPhotoQuoteInput & { priceIncGst: number; installM2: number; piesaIncGst: number | null; wholeVeec: OwnCustomerDraftInput["wholeVeec"]; metropolitan: boolean | null; minCopay: number }): OwnPhotoPreview {
  if (!(i.piesaIncGst != null && i.piesaIncGst > 0)) return { held: OWN_PHOTO_QUOTE_WORDS.noPiesa };
  let record: InstallerPriceRecord;
  try { record = ownPhotoPriceRecord(i); } catch (e) { return { held: (e as Error).message }; }
  const draft = ownPhotoQuoteDraft({ ...i, record, removeM2: i.removeM2 ?? 0 }, i.piesaIncGst);
  const amount = (code: string) => draft.lines.filter((l) => l.code === code).reduce((t, l) => t + l.line_total_inc_gst, 0);
  const ownerPays = Math.round((draft.subtotal - draft.discount) * 100) / 100;
  let rows: OwnQuoteRow[];
  try { rows = ownQuoteRows(draft.lines, draft.discount, ownerPays); } catch { return { held: draft.blockers[0] ?? OWN_PHOTO_QUOTE_WORDS.priceMissing }; }
  return { rows, ownerPays, feesLine: OWN_PHOTO_QUOTE_WORDS.feesLine(amount("AP_FEE"), amount("PIESA")) };
}

// ---------------------------------------------------------------- the quote breakdown (Jo 5 Nov 16:44 / 16:50)
import { ownCustomerRows, type OwnCustomerQuoteItem } from "./own-customer-price.core";

export type OwnQuoteRow = { label: string; amount: string; total?: true };
/** The standard own-customer rows (ownCustomerRows) as text: "Insulation — {what it includes}", the fee, the PIESA, the
 *  rebate and "Your price". Throws on a line set the approved rows can't show (callers show nothing then). */
export function ownQuoteRows(items: readonly OwnCustomerQuoteItem[], rebateIncGst: number, totalIncGst: number): OwnQuoteRow[] {
  const amount = (n: number) => `${n < 0 ? "−" : ""}${money(Math.abs(Math.round(n * 100) / 100))}`;
  return ownCustomerRows(items, rebateIncGst, totalIncGst).map((r) => ({ label: r.detail ? `${r.label} — ${r.detail}` : r.label, amount: amount(r.amountIncGst), ...(r.key === "total" ? { total: true as const } : {}) }));
}

/** The job page breakdown (Jo 16:50: no PDF, "it's just to show them their price"): the quote the Owner's quote row
 *  reads (an accepted one first, else the newest), as the standard rows. Null when there is none or its lines can't be
 *  shown (never a guessed row). Who may see it is decided by the caller (own customer, price-seeing people only). */
export function ownQuoteBreakdown(quotes: readonly { status: string | null; created_at: string | null; customer_total_inc_gst: number | string | null; veec_discount_inc_gst?: number | string | null; items: readonly { code: string | null; description?: string | null; sort?: number | null; line_total_inc_gst: number | string | null }[] }[]): OwnQuoteRow[] | null {
  const sorted = [...quotes].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const q = sorted.find((x) => x.status === "accepted") ?? sorted[0];
  if (!q || q.customer_total_inc_gst == null) return null;
  const items = [...q.items].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)).map((i) => ({ code: i.code, description: String(i.description ?? ""), line_total_inc_gst: Number(i.line_total_inc_gst) }));
  try { return ownQuoteRows(items, Number(q.veec_discount_inc_gst ?? 0), Number(q.customer_total_inc_gst)); } catch { return null; }
}
