// Decision 230 (Jo 24 Oct): "Our margin $X (Y%)" on the office Job page Money card, with an expandable breakdown
// (decision 233). Office only — never shown to installers, electricians or owners.
// Margin = owner price before the rebate − GST − installer pay − electrician PIESA cost − electrician fixes cost
//          (the $100 on fixes stays ours) + VEEC value we receive − VEEC incentive given to the owner.
// PURE: inputs come from the quote (+ quote_internals), recorded payouts / accepted offers, and the VEEC price.

export const FIXES_KEEP_INC = 100; // decision 142: +$100 spread across the fixes quote lines stays with us

export type MarginInput = {
  /** Installation quote before the VEEC incentive (quotes.subtotal_inc_gst). null = no quote yet. */
  ownerPriceInc: number | null;
  /** GST inside the owner's price (quotes.gst_amount; falls back to price ÷ 11). */
  ownerGstInc: number | null;
  /** Installer pay: recorded payout, else accepted offer pay, else quote_internals.cost_ex_gst × 1.1. */
  installerPay: number | null;
  installerPayBasis: string | null;
  /** Electrician PIESA cost (recorded payout / offer rate / approved rate card). null = rate to confirm. */
  piesaCost: number | null;
  /** Owner-direct electrician (installer's own) invoices the owner: no PIESA revenue or cost for us. */
  piesaOwnerDirect?: boolean;
  /** Electrical fixes quote accepted by the owner (inc GST) — its cost is the price less the $100 we keep. */
  fixesPriceInc: number | null;
  fixesCostInc?: number | null;
  /** VEECs (lodged quantity, else the quote's count) and the price we sell them for (actual sale, else current). */
  veecCount: number | null;
  veecPrice: number | null;
  veecPriceBasis: "actual sale" | "current setting" | null;
  /** VEU incentive given to the owner as a price reduction (quotes.veec_discount_inc_gst). */
  veecIncentiveInc: number | null;
};

export type MarginLine = { key: string; label: string; amount: number | null; sign: 1 | -1; note?: string };
export type MarginResult = { lines: MarginLine[]; margin: number | null; pct: number | null; missing: string[] };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function officeMargin(i: MarginInput): MarginResult {
  const missing: string[] = [];
  const gst = i.ownerPriceInc == null ? null : i.ownerGstInc ?? r2(i.ownerPriceInc / 11);
  const fixesCost = i.fixesPriceInc == null ? 0 : i.fixesCostInc ?? r2(Math.max(0, i.fixesPriceInc - FIXES_KEEP_INC));
  const veecValue = i.veecCount != null && i.veecPrice != null ? r2(i.veecCount * i.veecPrice) : null;
  const lines: MarginLine[] = [
    { key: "owner_price", label: "Owner price before rebate", amount: i.ownerPriceInc, sign: 1 },
    ...(i.fixesPriceInc != null ? [{ key: "fixes_price", label: "Electrical fixes price", amount: i.fixesPriceInc, sign: 1 as const }] : []),
    { key: "gst", label: "GST", amount: gst == null ? null : r2(gst + (i.fixesPriceInc != null ? i.fixesPriceInc / 11 : 0)), sign: -1 },
    { key: "installer_pay", label: "Installer pay", amount: i.installerPay, sign: -1, ...(i.installerPayBasis ? { note: i.installerPayBasis } : {}) },
    { key: "piesa", label: "Electrician PIESA", amount: i.piesaOwnerDirect ? 0 : i.piesaCost, sign: -1, ...(i.piesaOwnerDirect ? { note: "electrician invoices the owner directly" } : {}) },
    { key: "fixes_cost", label: "Fixes cost (fixes +$100 stays ours)", amount: fixesCost, sign: -1 },
    { key: "veec_value", label: "VEEC value received", amount: veecValue, sign: 1, ...(i.veecCount != null && i.veecPrice != null ? { note: `${i.veecCount} × $${i.veecPrice}${i.veecPriceBasis ? ` (${i.veecPriceBasis})` : ""}` } : {}) },
    { key: "veec_incentive", label: "VEEC incentive given", amount: i.veecIncentiveInc, sign: -1 },
  ];
  if (i.ownerPriceInc == null) missing.push("No installation quote yet");
  if (i.installerPay == null) missing.push("Installer pay not known yet");
  if (!i.piesaOwnerDirect && i.piesaCost == null) missing.push("Electrician PIESA rate to confirm");
  if (veecValue == null) missing.push("VEEC count or price not known yet");
  if (i.veecIncentiveInc == null) missing.push("VEEC incentive not on the quote");
  const margin = missing.length ? null : r2(lines.reduce((t, l) => t + l.sign * (l.amount ?? 0), 0));
  const revenue = (i.ownerPriceInc ?? 0) + (i.fixesPriceInc ?? 0);
  return { lines, margin, pct: margin != null && revenue > 0 ? Math.round((margin / revenue) * 100) : null, missing };
}
