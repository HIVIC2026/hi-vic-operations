// Photo-quote installers Part 2 (Jo 5 Nov 2026): a "From photos" installer adds their OWN customer with the photo quote in
// one press. The live quote on Add a job is built ONLY by `buildOwnCustomerQuoteDraft` (the same builder the issued quote
// uses), from the same draft input the server builds — no second pricing formula. PURE.
import { buildOwnCustomerQuoteDraft, type OwnCustomerDraftInput } from "./mitti-installer-quote.core";
import { insulationProduct } from "./insulation-product.core";
import { PHOTO_QUOTE_WORDS, photoQuoteProblems, sqm1, type PhotoQuoteInput } from "./photo-quote.core";

export const OWN_PHOTO_QUOTE_WORDS = {
  price: "Your price (inc GST, install + removal)",
  /** DRAFT. The $ figures are the actual amounts, never literals. */
  feesLine: (apFee: number, piesa: number) => `We add our ${money(apFee)} AP management fee and the ${money(piesa)} PIESA fee to your price.`,
  submit: "Add the job and send the quote",
  viewQuote: "View quote (PDF)",
  noPiesa: "Set this installer's PIESA price first",
  priceMissing: "Enter your price",
  overR2: "Over R2 isn't eligible for the rebate.",
  lines: { price: "Your price", piesa: "PIESA fee", apFee: "Home Insulation Victoria AP management fee", rebate: "Rebate" },
  ownerPays: "Owner pays",
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

export type OwnPhotoQuoteInput = PhotoQuoteInput & { priceIncGst: number | null };
/** Everything stopping "Add the job and send the quote" (the photo quote checks, then the price). */
export function ownPhotoQuoteProblems(i: OwnPhotoQuoteInput): string[] {
  // On Add a job there is no "Can't do this one": an over-R2 home just can't be added with a quote.
  const p = photoQuoteProblems(i).map((x) => (x === PHOTO_QUOTE_WORDS.overR2 ? OWN_PHOTO_QUOTE_WORDS.overR2 : x));
  if (!(typeof i.priceIncGst === "number" && Number.isFinite(i.priceIncGst) && i.priceIncGst > 0)) p.push(OWN_PHOTO_QUOTE_WORDS.priceMissing);
  return p;
}

/** What the installer's own quote "includes" text says (the owner sees it on the Insulation line). */
export function ownPhotoIncludes(i: { product: string | null; removeM2: number | null }): string {
  const product = insulationProduct(i.product)?.option ?? "Ceiling insulation";
  const remove = sqm1(i.removeM2) ?? 0;
  return `${product} supplied and installed${remove > 0 ? `, removal of existing insulation (${remove} m²)` : ""}`;
}

/** The draft input exactly as installer-quote.server builds it on the intake-price path (Part 2 issue path). */
export function ownPhotoDraftInput(i: { priceIncGst: number; installM2: number; product: string | null; removeM2: number | null; wholeVeec: OwnCustomerDraftInput["wholeVeec"]; metropolitan: boolean | null; minCopay: number }): OwnCustomerDraftInput {
  return {
    price: { ok: true, issues: [], price: { included: [ownPhotoIncludes(i)], otherDescription: "", totalIncGst: Math.round(i.priceIncGst * 100) / 100, agreedWithOwner: false } } as OwnCustomerDraftInput["price"],
    measuredM2: sqm1(i.installM2), wholeVeec: i.wholeVeec, separateLines: [],
    caps: { metropolitan: i.metropolitan, minCopay: i.minCopay },
  };
}

export type OwnPhotoPreview = { lines: { label: string; amount: number }[]; ownerPays: number; feesLine: string } | { held: string };
/** The live quote under the price: Your price + PIESA fee + AP management fee − rebate = owner pays. */
export function ownPhotoQuotePreview(i: { priceIncGst: number; installM2: number; product: string | null; removeM2?: number | null; piesaIncGst: number | null; wholeVeec: OwnCustomerDraftInput["wholeVeec"]; metropolitan: boolean | null; minCopay: number }): OwnPhotoPreview {
  if (!(i.piesaIncGst != null && i.piesaIncGst > 0)) return { held: OWN_PHOTO_QUOTE_WORDS.noPiesa };
  const draft = buildOwnCustomerQuoteDraft(ownPhotoDraftInput({ ...i, removeM2: i.removeM2 ?? 0 }), i.piesaIncGst);
  const amount = (code: string) => draft.lines.filter((l) => l.code === code).reduce((t, l) => t + l.line_total_inc_gst, 0);
  const W = OWN_PHOTO_QUOTE_WORDS.lines;
  const ap = amount("AP_FEE"), piesa = amount("PIESA");
  return {
    lines: [{ label: W.price, amount: amount("INSTALLER_PRICE") }, { label: W.piesa, amount: piesa }, { label: W.apFee, amount: ap }, { label: W.rebate, amount: -draft.discount }],
    ownerPays: Math.round((draft.subtotal - draft.discount) * 100) / 100,
    feesLine: OWN_PHOTO_QUOTE_WORDS.feesLine(ap, piesa),
  };
}

// ---------------------------------------------------------------- "View quote (PDF)" (own customers only)
import type { PdfBlock } from "./pdf-look.core";
import { ownCustomerRows, type OwnCustomerQuoteItem } from "./own-customer-price.core";
import { quoteExpiresAt, quoteValidDaysFor } from "./quote-expiry.core";

/** Only the installer's OWN customer (channel installer_sourced, from this business) and only price-seeing people. */
export function viewQuoteAllowed(f: { channel: string | null; originatingBusinessId: string | null; businessId: string; seesPrices: boolean }): boolean {
  return f.channel === "installer_sourced" && f.originatingBusinessId === f.businessId && f.seesPrices;
}

const MELB_DATE = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" });
/** "R5.0 glasswool batts" — every approved product (Bradford Gold, Pink Batts, Earthwool) is a glasswool batt. */
export function plainProductName(option: string | null | undefined): string | null {
  const p = insulationProduct(option);
  return p ? `${p.rValue} glasswool batts` : null;
}

/** The quote PDF (Jo 5 Nov 2026 16:10 layout): Home Insulation Victoria's logo and details with the installer's logo
 *  top-left (both logos), the job, Status with the quote date and how long it's valid under it, then the rows from the
 *  quote's own lines (never re-priced): the insulation line split into "{R} glasswool batts supplied and installed · {m²}"
 *  (the installer's price) and "Old insulation removed · {m²}" ("included" unless the quote prices removal separately).
 *  Throws on a line set the approved rows can't show (the caller says the PDF isn't available). */
export function ownQuotePdfBlocks(f: { jobNumber: string | null; owner: string | null; address: string | null; items: OwnCustomerQuoteItem[]; rebateIncGst: number; totalIncGst: number; status: string;
  /** The approved product option on the job (null = the quote line's own words). */ product?: string | null; installM2?: number | null; removeM2?: number | null;
  /** When the quote was sent (else made): the quote date and the start of its validity. */ quoteDate?: string | null },
  partnerLogo: { bytes: Uint8Array; width: number; height: number; alt: string } | null): PdfBlock[] {
  const rows = ownCustomerRows(f.items, f.rebateIncGst, f.totalIncGst);
  const amount = (n: number) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;
  const install = sqm1(f.installM2 ?? null), remove = sqm1(f.removeM2 ?? null) ?? 0;
  const productName = plainProductName(f.product);
  const removalItem = f.items.find((i) => i.code === "INSTALLER_REMOVAL") ?? null;
  const moneyRows = rows.flatMap((r): { label: string; amount: string; strong?: boolean; green?: boolean }[] => {
    if (r.key === "insulation") {
      const label = productName ? `${productName} supplied and installed${install ? ` · ${install} m²` : ""}` : r.detail ? `${r.label} — ${r.detail}` : r.label;
      const removal = remove > 0 ? [{ label: `Old insulation removed · ${remove} m²`, amount: removalItem ? amount(removalItem.line_total_inc_gst) : "included" }] : [];
      return [{ label, amount: amount(r.amountIncGst) }, ...removal];
    }
    if (r.key === "extra" && removalItem && remove > 0 && r.label === removalItem.description) return [];
    return [{ label: r.detail ? `${r.label} — ${r.detail}` : r.label, amount: amount(r.amountIncGst), ...(r.key === "total" ? { strong: true } : {}), ...(r.key === "rebate" ? { green: true } : {}) }];
  });
  const when = f.quoteDate ? new Date(f.quoteDate) : null;
  const dated = when && Number.isFinite(when.getTime())
    ? [`Quote date ${MELB_DATE.format(when)}`, `Valid for ${quoteValidDaysFor(when)} days, until ${MELB_DATE.format(new Date(quoteExpiresAt(when).getTime() - 1))}`] : [];
  return [
    { id: "q-head", kind: "header", eyebrow: `QUOTE${f.jobNumber ? ` · JOB ${f.jobNumber}` : ""}`, withAddress: true, ...(partnerLogo ? { partnerLogo } : {}) },
    { id: "q-title", kind: "title", text: "Your ceiling insulation quote", ...(f.address ? { sub: f.address } : {}) },
    { id: "q-facts", kind: "facts", rows: [["Owner", f.owner ?? "—"], ["Status", [f.status, ...dated].join("\n")]] },
    { id: "q-money", kind: "money", rows: moneyRows },
    { id: "q-note", kind: "para", small: true, muted: true, text: "All prices include GST. The rebate is taken off the price." },
  ];
}
