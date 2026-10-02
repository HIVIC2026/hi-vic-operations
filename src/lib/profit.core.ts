// Pure Home Insulation Victoria profit + VEEC spot-price rules. Admin-only; never shown to owners or trades.
export const OWNER_VEEC_RATE = 70; // $ per VEEC passed to the owner as the VEU discount

export type SpotPoint = { price: number; priced_on: string };
export type SellSignal = { latest: number | null; avg90: number | null; change: number | null; good: boolean; reason: string };

export function sellSignal(history: SpotPoint[], today: Date): SellSignal {
  const sorted = [...history].sort((a, b) => b.priced_on.localeCompare(a.priced_on));
  const latest = sorted[0]?.price ?? null;
  if (latest == null) return { latest: null, avg90: null, change: null, good: false, reason: "No spot price recorded yet." };
  const cutoff = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const window = sorted.filter((p) => p.priced_on >= cutoff);
  const avg90 = window.length ? window.reduce((t, p) => t + p.price, 0) / window.length : null;
  const change = sorted[1] ? latest - sorted[1].price : null;
  if (avg90 != null && window.length >= 3 && latest >= avg90 * 1.05) return { latest, avg90, change, good: true, reason: "Spot price is 5%+ above the 90-day average – good time to sell." };
  if (avg90 != null && window.length >= 3 && latest < avg90 * 0.95) return { latest, avg90, change, good: false, reason: "Spot price is 5%+ below the 90-day average – consider holding." };
  return { latest, avg90, change, good: false, reason: window.length < 3 ? "Record at least 3 prices in 90 days to judge the trend." : "Spot price is near its 90-day average." };
}

export type ProfitInput = { customerTotalIncGst: number; veecDiscountIncGst: number; tradeCostExGst: number };
export function jobProfit(i: ProfitInput, spot: number | null) {
  const customerExGst = i.customerTotalIncGst / 1.1;
  const veecs = i.veecDiscountIncGst / OWNER_VEEC_RATE;
  const veecRevenue = spot != null ? veecs * spot : null;
  // Home Insulation Victoria keeps spot − $70 per VEEC; the owner's $70 is already given as their discount.
  const veecMargin = spot != null ? veecs * (spot - OWNER_VEEC_RATE) : null;
  const profit = veecMargin != null ? customerExGst + veecMargin - i.tradeCostExGst : null;
  return { customerExGst, veecs, veecRevenue, veecMargin, profit };
}

// Home Insulation Victoria lead fee: deducted from the installer payout only after
// installation and AP paperwork approval. Never applies to an installer's own customer.
export const HIVIC_LEAD_FEE_INC_GST = 220;

export type MarginInput = {
  installerCostExGst: number; // what Home Insulation Victoria pays the installer (rate card)
  installerMarginExGst: number; // Home Insulation Victoria markup on the installer work (ap_margin_pct)
  apFeeExGst: number; // PIESA / Accredited Person fee charged to the owner ($349 inc GST → 317.27 ex)
  electricalCostExGst: number; // what Home Insulation Victoria pays the electrician/REC for rectification (pass-through)
  electricalChargeExGst: number; // what the customer is charged for electrical work (pass-through → markup 0)
  installerSourced: boolean; // legacy name: true means Home Insulation Victoria supplied the customer
  installerLed?: boolean; // installer brought their own customer: never a lead fee
  leadFeeEarned?: boolean; // installation complete and required paperwork approved
  veecDiscountIncGst: number; // owner's discount → VEEC count at $70 each
  piesaRecCostExGst: number | null; // negotiated lower set rate paid to the REC for the PIESA; null = not agreed/recorded yet
  veecLodgementFeeExGst: number | null; // ESC fee per VEEC created/registered; null = not set
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per-job markup: what we charge vs what we pay, per trade, plus the PIESA fee, referral fee, ESC lodgement fee and VEEC margin. */
export function jobMargin(i: MarginInput, spot: number | null) {
  const installerChargedEx = r2(i.installerCostExGst + i.installerMarginExGst + i.apFeeExGst);
  const installerMarkup = r2(i.installerMarginExGst); // pure markup (PIESA fee is shown separately)
  const piesaChargeEx = r2(i.apFeeExGst);
  const piesaRecPaidEx = i.piesaRecCostExGst == null ? null : r2(i.piesaRecCostExGst);
  const piesaMarginEx = piesaRecPaidEx == null ? null : r2(i.apFeeExGst - i.piesaRecCostExGst!);
  const electricalMarkup = r2(i.electricalChargeExGst - i.electricalCostExGst); // upgrades pass through at the agreed rate card
  const referralFeeEx = i.installerSourced && !i.installerLed && i.leadFeeEarned === true ? r2(HIVIC_LEAD_FEE_INC_GST / 1.1) : 0;
  const veecs = i.veecDiscountIncGst / OWNER_VEEC_RATE;
  const veecMargin = spot != null ? r2(veecs * (spot - OWNER_VEEC_RATE)) : null;
  const lodgementFeeEx = i.veecLodgementFeeExGst == null ? null : r2(veecs * i.veecLodgementFeeExGst);
  // When the negotiated REC PIESA rate is not recorded yet the PIESA charge is kept whole (optimistic)
  // and the row is flagged in the UI; the ESC lodgement fee comes off per VEEC once set.
  const tradeMargin = r2(installerMarkup + (piesaMarginEx ?? i.apFeeExGst) + electricalMarkup - referralFeeEx - (lodgementFeeEx ?? 0));
  const profit = veecMargin != null ? r2(tradeMargin + veecMargin) : null;
  return { installerChargedEx, installerMarkup, piesaChargeEx, piesaRecPaidEx, piesaMarginEx, electricalMarkup, referralFeeEx, veecs, veecMargin, lodgementFeeEx, tradeMargin, profit };
}

// Parse the current VEEC spot price from the Ecovantage weekly market update HTML.
// The VEEC paragraph states the move (e.g. "softened from $86.50 down to $85.80");
// the current price is the LAST dollar figure in that paragraph. Returns null when
// the wording changes — fail closed, never guess.
export function parseVeecSpotFromHtml(html: string): number | null {
  const text = html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#038;/g, "&").replace(/\s+/g, " ");
  // Pages mention "VEEC" in menus too; use the first mention followed by a price nearby.
  for (const m of text.matchAll(/VEEC/gi)) {
    const window = text.slice(m.index, m.index + 400);
    if (!window.includes("$")) continue;
    // A period only ends the sentence when it is not a decimal point.
    const end = window.search(/\.(?!\d)/);
    const sentence = end < 0 ? window : window.slice(0, end);
    const amounts = [...sentence.matchAll(/\$(\d+(?:\.\d{1,2})?)/g)].map((a) => Number(a[1])).filter((n) => n > 0 && n < 1000);
    if (amounts.length) return amounts[amounts.length - 1]!;
  }
  return null;
}
