import { MITTI_INSTALLER_FEE_INC_GST } from "./usual-electrician.core";
import { cobrandLogos, type CobrandLogo } from "./cobrand.core";

/**
 * Own-customer (installer-sourced) quote and tax-invoice lines — Part 10 Task 1 (Jo 2 Nov 2026, "FEES … CORRECTION" +
 * "OWN CUSTOMERS quote + invoice lines"). Pure: builds the owner-facing rows from `quote_items.code`, never from a
 * description, so "Home Insulation Victoria fee" can never be mistaken for the insulation product.
 *
 * Owner's price = installer's price (+ separately agreed extras) + $349 Home Insulation Victoria fee + $349 PIESA − rebate.
 * The PIESA line is $349 whatever the electrician's own rate (they are still paid their rate; Home Insulation Victoria
 * keeps the difference). Home Insulation Victoria leads (`hivic_sourced`) never come through here.
 */

/** Owner-facing PIESA line on an own-customer quote: always $349, whatever the electrician is paid. */
export const OWN_CUSTOMER_PIESA_INC_GST = 349;
/** Owner-facing Home Insulation Victoria (Accredited Person) fee on an own-customer quote: $349. */
export const OWN_CUSTOMER_AP_FEE_INC_GST: number = MITTI_INSTALLER_FEE_INC_GST;

/** Approved labels, verbatim, in the approved order (plan header). */
export const OWN_CUSTOMER_LABELS = {
  insulation: "Insulation",
  apFee: "Home Insulation Victoria fee",
  piesa: "Electrical safety check (PIESA)",
  rebate: "Rebate",
  total: "Your price",
} as const;

export type OwnCustomerRowKey = "insulation" | "extra" | "apFee" | "piesa" | "rebate" | "total";

export type OwnCustomerRow = {
  key: OwnCustomerRowKey;
  label: string;
  /** Insulation: the item's own description (product / area / inclusions). Everything else: null. */
  detail: string | null;
  /** Inc GST. Rebate is negative (or 0). */
  amountIncGst: number;
};

export type OwnCustomerQuoteItem = { code: string | null; description: string; line_total_inc_gst: number };

const EXTRA_CODES: ReadonlySet<string> = new Set(["INSTALLER_REMOVAL", "INSTALLER_EXTRA"]);

/**
 * Rows in the approved order: Insulation → (extras, in the order given, each under its own words) →
 * Home Insulation Victoria fee → Electrical safety check (PIESA) → Rebate → Your price.
 *
 * - `INSTALLER_PRICE` → insulation (exactly one required; detail = its description).
 * - `INSTALLER_REMOVAL` / `INSTALLER_EXTRA` → extra (label = its description).
 * - `AP_FEE` / `PIESA` → the fixed $349 lines (exactly one of each required), always at $349 whatever amount the item
 *   carries (an older draft priced the PIESA at the electrician's rate — Task 2 holds such drafts before they are sent).
 * - Anything else, a missing line or a doubled line throws — fail closed, never guess a label or a fee.
 *
 * `rebateIncGst` and `totalIncGst` come from the quote (discount / after-discount): this module does not re-add the lines,
 * so the caller's release checks stay the one place that proves the total.
 */
export function ownCustomerRows(items: readonly OwnCustomerQuoteItem[], rebateIncGst: number, totalIncGst: number): OwnCustomerRow[] {
  let insulation: OwnCustomerRow | null = null;
  const extras: OwnCustomerRow[] = [];
  const seen = { AP_FEE: 0, PIESA: 0 };
  for (const it of items) {
    const code = it.code;
    if (code === "INSTALLER_PRICE") {
      if (insulation) throw new Error("Own-customer quote has more than one INSTALLER_PRICE line");
      insulation = { key: "insulation", label: OWN_CUSTOMER_LABELS.insulation, detail: it.description, amountIncGst: it.line_total_inc_gst };
    } else if (code != null && EXTRA_CODES.has(code)) {
      extras.push({ key: "extra", label: it.description, detail: null, amountIncGst: it.line_total_inc_gst });
    } else if (code === "AP_FEE" || code === "PIESA") {
      // Fixed lines below; the item's own amount/description is never shown.
      seen[code] += 1;
    } else {
      throw new Error(`Unknown own-customer quote line: ${code}`);
    }
  }
  if (!insulation) throw new Error("Own-customer quote has no INSTALLER_PRICE line");
  for (const code of ["AP_FEE", "PIESA"] as const) {
    if (seen[code] === 0) throw new Error(`Own-customer quote has no ${code} line`);
    if (seen[code] > 1) throw new Error(`Own-customer quote has more than one ${code} line`);
  }
  const rebate = rebateIncGst === 0 ? 0 : -Math.abs(rebateIncGst);
  return [
    insulation,
    ...extras,
    { key: "apFee", label: OWN_CUSTOMER_LABELS.apFee, detail: null, amountIncGst: OWN_CUSTOMER_AP_FEE_INC_GST },
    { key: "piesa", label: OWN_CUSTOMER_LABELS.piesa, detail: null, amountIncGst: OWN_CUSTOMER_PIESA_INC_GST },
    { key: "rebate", label: OWN_CUSTOMER_LABELS.rebate, detail: null, amountIncGst: rebate },
    { key: "total", label: OWN_CUSTOMER_LABELS.total, detail: null, amountIncGst: totalIncGst },
  ];
}

/**
 * Part 10 Task 6: the owner's quote page (and anything else that shows an own customer's quote) — the installer's logo
 * beside ours and the approved rows. Both null unless the job is an installer's own customer AND the one co-brand switch
 * (`approved` = OWN_CUSTOMER_COBRAND_APPROVED) is on. A missing / non-https logo → `cobrand` null (our logo alone); a
 * malformed line set → `rows` null (the page keeps its generic rows; never a guessed label or fee).
 */
export function ownCustomerQuoteView(f: {
  channel: string | null; approved: boolean; installerName: string | null; logoUrl: string | null;
  items: readonly OwnCustomerQuoteItem[]; rebateIncGst: number; totalIncGst: number;
}): { cobrand: CobrandLogo | null; rows: OwnCustomerRow[] | null } {
  if (f.channel !== "installer_sourced" || !f.approved) return { cobrand: null, rows: null };
  const cobrand = cobrandLogos({ installerName: f.installerName, logoUrl: f.logoUrl }).installer;
  let rows: OwnCustomerRow[] | null;
  try { rows = ownCustomerRows(f.items, f.rebateIncGst, f.totalIncGst); } catch { rows = null; }
  return { cobrand, rows };
}
