// Decision 230 (Jo, 24 Oct 2026): "Our margin" per job — OFFICE ONLY, never shown to installers, electricians or owners.
// The ONE pure margin rule shared by the office Money screen (per-job column + monthly total) and the Job page Money card.
//
//   margin = owner price before the rebate (ex GST)
//          − installer pay − electrician PIESA cost − electrician fixes cost   (the $100 on fixes stays ours: it is in the
//            owner price and never in the electrician's cost)
//          + VEEC value we receive − VEEC incentive given to the owner        ("VEEC net")
//
// Approved O6 Money mock-up (decision 243): price is shown inc GST and before the VEEC incentive; trade costs and the VEEC
// net are subtracted/added after GST comes off the price; the % is margin ÷ price (inc GST), rounded to a whole percent.
// Unknown inputs are never guessed: the margin is null and `missing` says what is needed.

export type JobMarginInput = {
  /** Owner price before the VEEC incentive, inc GST: the accepted quotes' subtotals (installation + electrical fixes). */
  ownerPriceInc: number | null;
  /** GST rate (0.1). */
  gstRate?: number;
  /** What we pay the installer, ex GST (accepted installation quote's agreed-rate cost). */
  installerPayEx: number | null;
  /** Electrician PIESA cost, ex GST. 0 when the installer's own electrician bills the owner directly. null = rate not agreed. */
  piesaCostEx: number | null;
  /** false = no electrician assigned or accepted yet, so a missing PIESA cost says that (not "rate not agreed"). Default true. */
  electricianChosen?: boolean;
  /** Electrician fixes cost, ex GST (accepted fixes quote's cost). 0 when there are no fixes. */
  fixesCostEx: number;
  /** VEEC value we receive ($). null = not worked out yet. */
  veecValue: number | null;
  /** VEEC incentive given to the owner ($): the accepted quote's VEEC discount. */
  veecIncentive: number;
};

export type JobMarginLine = { key: "price" | "gst" | "installer" | "piesa" | "fixes" | "veec_value" | "veec_incentive"; label: string; amount: number | null };

export type JobMargin = {
  known: boolean;
  missing: string[];
  priceInc: number | null;
  priceEx: number | null;
  installerPay: number | null;
  electrician: number | null;
  veecNet: number | null;
  margin: number | null;
  /** Whole percent of the price inc GST, or null. */
  pct: number | null;
  /** The expandable breakdown, in order (signed amounts: costs negative). */
  lines: JobMarginLine[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function jobMargin(i: JobMarginInput): JobMargin {
  const gst = 1 + (i.gstRate ?? 0.1);
  const missing: string[] = [];
  if (i.ownerPriceInc == null || !(i.ownerPriceInc > 0)) missing.push("No accepted quote yet");
  if (i.installerPayEx == null) missing.push("Installer pay not recorded on the quote");
  if (i.piesaCostEx == null) missing.push(i.electricianChosen === false ? "No electrician chosen yet" : "Electrician PIESA rate not agreed");
  if (i.veecValue == null) missing.push("VEEC value not worked out (no VEEC count)");
  const priceInc = i.ownerPriceInc != null && i.ownerPriceInc > 0 ? r2(i.ownerPriceInc) : null;
  const priceEx = priceInc != null ? r2(priceInc / gst) : null;
  const electrician = i.piesaCostEx != null ? r2(i.piesaCostEx + Math.max(0, i.fixesCostEx)) : null;
  const veecNet = i.veecValue != null ? r2(i.veecValue - Math.max(0, i.veecIncentive)) : null;
  const known = missing.length === 0;
  const margin = known ? r2(priceEx! - i.installerPayEx! - electrician! + veecNet!) : null;
  const pct = margin != null && priceInc ? Math.round((margin / priceInc) * 100) : null;
  const lines: JobMarginLine[] = [
    { key: "price", label: "Owner price before the rebate (inc GST)", amount: priceInc },
    { key: "gst", label: "GST", amount: priceInc != null && priceEx != null ? -r2(priceInc - priceEx) : null },
    { key: "installer", label: "Installer pay", amount: i.installerPayEx != null ? -r2(i.installerPayEx) : null },
    { key: "piesa", label: "Electrician PIESA cost", amount: i.piesaCostEx != null ? -r2(i.piesaCostEx) : null },
    { key: "fixes", label: "Electrician fixes cost (the $100 on fixes with our electrician stays ours)", amount: -r2(Math.max(0, i.fixesCostEx)) },
    { key: "veec_value", label: "VEEC value we receive", amount: i.veecValue != null ? r2(i.veecValue) : null },
    { key: "veec_incentive", label: "VEEC incentive given to the owner", amount: -r2(Math.max(0, i.veecIncentive)) },
  ];
  return { known, missing, priceInc, priceEx, installerPay: i.installerPayEx != null ? r2(i.installerPayEx) : null, electrician, veecNet, margin, pct, lines };
}

/** Electrician PIESA cost ex GST for one job: 0 when the owner pays the electrician directly; else the recorded payout,
 *  else the accepted PIESA offer's rate, else the chosen electrician's rate card PIESA rate; null when none is known. */
export function piesaCostExFor(i: { ownerDirect: boolean; paidOutInc: number | null; offerRateInc: number | null; rateCardInc: number | null; gstRate?: number }): number | null {
  if (i.ownerDirect) return 0;
  const inc = i.paidOutInc ?? i.offerRateInc ?? i.rateCardInc;
  return inc == null || !Number.isFinite(Number(inc)) ? null : r2(Number(inc) / (1 + (i.gstRate ?? 0.1)));
}

/** Installer pay ex GST: a recorded payout/offer, else the quote's agreed cost, else (installer's own jobs only) the price
 *  the business owner entered in the portal — that price is what we pay them (Jo 27 Oct 2026, HV-3385). */
export function installerPayExFor(i: { recordedInc: number | null | undefined; quoteCostEx: number | null | undefined; portalPriceInc: number | null | undefined; installerSourced: boolean; gstRate?: number }): number | null {
  const g = 1 + (i.gstRate ?? 0.1);
  if (i.recordedInc != null && Number.isFinite(Number(i.recordedInc))) return r2(Number(i.recordedInc) / g);
  if (i.quoteCostEx != null && Number(i.quoteCostEx) > 0) return r2(Number(i.quoteCostEx));
  if (i.installerSourced && i.portalPriceInc != null && Number(i.portalPriceInc) > 0) return r2(Number(i.portalPriceInc) / g);
  return null;
}

/** VEEC value we receive: the lodged quantity at the sale price once sold; otherwise the quote's VEEC count at today's spot price. */
export function veecValueReceived(f: { lodgedQty: number | null; salePrice: number | null; quoteCount: number | null; spotPrice: number | null }): { value: number | null; basis: "sold" | "lodged at today's price" | "quote at today's price" | "unknown" } {
  if (f.lodgedQty != null && f.salePrice != null) return { value: r2(f.lodgedQty * f.salePrice), basis: "sold" };
  if (f.lodgedQty != null && f.spotPrice != null) return { value: r2(f.lodgedQty * f.spotPrice), basis: "lodged at today's price" };
  if (f.quoteCount != null && f.spotPrice != null) return { value: r2(f.quoteCount * f.spotPrice), basis: "quote at today's price" };
  return { value: null, basis: "unknown" };
}

/** Monthly total for the Money Overview tile: only jobs whose margin is known count; the average % is weighted by price. */
export function marginTotal(rows: Pick<JobMargin, "margin" | "priceInc">[]): { total: number; jobs: number; pct: number | null; unknown: number } {
  const known = rows.filter((r) => r.margin != null && r.priceInc != null);
  const total = r2(known.reduce((a, r) => a + r.margin!, 0));
  const price = known.reduce((a, r) => a + r.priceInc!, 0);
  return { total, jobs: known.length, pct: price > 0 ? Math.round((total / price) * 100) : null, unknown: rows.length - known.length };
}
