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
  const veecMargin = spot != null ? veecs * (spot - OWNER_VEEC_RATE) : null;
  const profit = veecRevenue != null ? customerExGst + veecRevenue - i.tradeCostExGst : null;
  return { customerExGst, veecs, veecRevenue, veecMargin, profit };
}
