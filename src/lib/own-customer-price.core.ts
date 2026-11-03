import { MITTI_INSTALLER_FEE_INC_GST } from "./usual-electrician.core";

const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
 * - `AP_FEE` / `PIESA` → the fixed $349 lines (exactly one of each required). I1 (final review): NEVER re-priced — an item
 *   at any other amount (an older quote priced at the electrician's $275 rate) throws, and every caller falls back to the
 *   generic rows, so an owner is never shown a figure their quote doesn't carry.
 * - Anything else, a missing line, a doubled line, or rows that don't add up to `totalIncGst` (±1c) throws — fail closed,
 *   never guess a label, a fee or a total.
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
      const want = code === "AP_FEE" ? OWN_CUSTOMER_AP_FEE_INC_GST : OWN_CUSTOMER_PIESA_INC_GST;
      if (Math.abs(it.line_total_inc_gst - want) > 0.005) throw new Error(`Own-customer quote ${code} line is ${aud(it.line_total_inc_gst)}, not ${aud(want)}`);
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
  const sum = insulation.amountIncGst + extras.reduce((a, e) => a + e.amountIncGst, 0) + OWN_CUSTOMER_AP_FEE_INC_GST + OWN_CUSTOMER_PIESA_INC_GST + rebate;
  if (Math.abs(sum - totalIncGst) > 0.0101) throw new Error(`Own-customer quote rows add up to ${aud(sum)}, not the quote total ${aud(totalIncGst)}`);
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

// ---------- Part 10 Task 9: Job details money rows and the pay rule ----------
/** Jo 3 Nov 2026: the own-customer pay rule, stated plainly (moved here from installer-screens.core; imported back there). */
export const OWN_CUSTOMER_PAY_RULE = "Your customers are paid once the office approves the paperwork and the owner has paid their balance.";

const wholeAud = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/**
 * The money rows in the Job details fold. Own customer: the owner's quote (price — Part 5 `seesPrices`) and the installer's
 * own pay (Money — Part 5 `seesMoney`, defaults to `canSeePrices`); Home Insulation Victoria lead: the installer's pay only,
 * never the owner's price. Lead Installers / Crew (no prices) get nothing. `payRule` (approved Money line) sits on the pay row.
 */
export function jobMoneyRows(f: {
  channel: string | null; canSeePrices: boolean; canSeeMoney?: boolean;
  ownerPriceIncGst: number | null; installerPriceIncGst: number | null; hivLeadPayIncGst: number | null; payRule?: string | null;
}): [string, string][] {
  if (!f.canSeePrices) return [];
  const money = f.canSeeMoney ?? f.canSeePrices;
  const pay = (n: number) => `${wholeAud(n)}${f.payRule ? ` · ${f.payRule}` : ""}`;
  const rows: [string, string][] = [];
  if (f.channel === "installer_sourced") {
    if (f.ownerPriceIncGst != null) rows.push(["Owner's quote", wholeAud(f.ownerPriceIncGst)]);
    if (money && f.installerPriceIncGst != null) rows.push(["Your pay", pay(f.installerPriceIncGst)]);
    return rows;
  }
  if (money && f.hivLeadPayIncGst != null) rows.push(["Your pay", pay(f.hivLeadPayIncGst)]);
  return rows;
}

/** I3: the quote the Job details money rows read — an ACCEPTED installation quote first (as `installerPayForJob`), else the
 *  newest; the installer's pay = their own lines (INSTALLER_PRICE + INSTALLER_REMOVAL + INSTALLER_EXTRA), never the fee,
 *  the PIESA or the owner's total. Nothing usable → nulls (rows left out). */
export function ownCustomerQuoteFigures(quotes: readonly { status: string | null; created_at: string | null; customer_total_inc_gst: number | string | null; items: readonly { code: string | null; line_total_inc_gst: number | string | null }[] }[]): { installerPayIncGst: number | null; ownerPriceIncGst: number | null } {
  const sorted = [...quotes].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const pick = sorted.find((q) => q.status === "accepted") ?? sorted[0];
  if (!pick) return { installerPayIncGst: null, ownerPriceIncGst: null };
  const mine = pick.items.filter((it) => it.code === "INSTALLER_PRICE" || it.code === "INSTALLER_REMOVAL" || it.code === "INSTALLER_EXTRA");
  const pay = mine.reduce((a, it) => a + (Number(it.line_total_inc_gst) || 0), 0);
  const total = pick.customer_total_inc_gst == null ? NaN : Number(pick.customer_total_inc_gst);
  return { installerPayIncGst: mine.some((it) => it.code === "INSTALLER_PRICE") && pay > 0 ? Math.round(pay * 100) / 100 : null, ownerPriceIncGst: Number.isFinite(total) ? total : null };
}
