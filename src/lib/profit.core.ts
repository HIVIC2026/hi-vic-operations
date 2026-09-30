// Pure HI VIC profit + VEEC spot-price rules. Admin-only; never shown to owners or trades.
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
  // HI VIC keeps spot − $70 per VEEC; the owner's $70 is already given as their discount.
  const veecMargin = spot != null ? veecs * (spot - OWNER_VEEC_RATE) : null;
  const profit = veecMargin != null ? customerExGst + veecMargin - i.tradeCostExGst : null;
  return { customerExGst, veecs, veecRevenue, veecMargin, profit };
}

// Installer referral: the installer is paid a referral fee (inc GST) only when an
// installer-sourced job proceeds with an accepted quote. It is a cost to HI VIC.
export const INSTALLER_REFERRAL_FEE_INC_GST = 220;

export type MarginInput = {
  installerCostExGst: number; // what HI VIC pays the installer (rate card)
  installerMarginExGst: number; // HI VIC markup on the installer work (ap_margin_pct)
  apFeeExGst: number; // Accredited Person fee charged on top
  electricalCostExGst: number; // what HI VIC pays the electrician/REC
  electricalChargeExGst: number; // what the customer is charged for electrical work
  installerSourced: boolean; // $220 referral fee applies when the job proceeds
  veecDiscountIncGst: number; // owner's discount → VEEC count at $70 each
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per-job markup: what we charge vs what we pay, per trade, plus the AP fee, referral fee and VEEC margin. */
export function jobMargin(i: MarginInput, spot: number | null) {
  const installerChargedEx = r2(i.installerCostExGst + i.installerMarginExGst + i.apFeeExGst);
  const installerMarkup = r2(i.installerMarginExGst); // pure markup (AP fee is shown separately)
  const apFee = r2(i.apFeeExGst);
  const electricalMarkup = r2(i.electricalChargeExGst - i.electricalCostExGst);
  const referralFeeEx = i.installerSourced ? r2(INSTALLER_REFERRAL_FEE_INC_GST / 1.1) : 0;
  const veecs = i.veecDiscountIncGst / OWNER_VEEC_RATE;
  const veecMargin = spot != null ? r2(veecs * (spot - OWNER_VEEC_RATE)) : null;
  const tradeMargin = r2(installerMarkup + apFee + electricalMarkup - referralFeeEx);
  const profit = veecMargin != null ? r2(tradeMargin + veecMargin) : null;
  return { installerChargedEx, installerMarkup, apFee, electricalMarkup, referralFeeEx, veecs, veecMargin, tradeMargin, profit };
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
