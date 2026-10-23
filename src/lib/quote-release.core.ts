export type QuoteRelease = {
  state: "held" | "queued" | "released";
  reason: string | null;
  status: "draft" | "issued";
};

const pct = (estimate: number, quote: number) => Math.abs(quote - estimate) / estimate * 100;

export function estimateVarianceReason(estimateTotal: number | null, quoteTotal: number, tolerancePct: number): string | null {
  if (estimateTotal == null || !Number.isFinite(estimateTotal) || estimateTotal <= 0) return "Quote held: no current owner estimate to compare";
  const variance = pct(estimateTotal, quoteTotal);
  if (variance <= tolerancePct + Number.EPSILON) return null;
  const direction = quoteTotal >= estimateTotal ? "up" : "down";
  return `Quote held: price ${direction} ${Math.round(variance)}% on estimate`;
}

export function confirmedQuoteDecision(input: {
  estimateTotal: number | null;
  quoteTotal: number;
  tolerancePct: number;
  hasUnratedExtras: boolean;
  externalSendingEnabled: boolean;
}): QuoteRelease {
  const reason = input.hasUnratedExtras
    ? "Quote held: includes an extra not on the agreed rate card"
    : estimateVarianceReason(input.estimateTotal, input.quoteTotal, input.tolerancePct);
  if (reason) return { state: "held", reason, status: "draft" };
  return { state: "held", reason: "Waiting for office review before sending", status: "draft" };
}

export function rectificationQuoteDecision(input: {
  hasNonStandardItem: boolean;
  manuallyPriced: boolean;
  externalSendingEnabled: boolean;
}): QuoteRelease {
  const reason = input.hasNonStandardItem
    ? "Quote held: includes a non-standard electrical fixes item"
    : input.manuallyPriced
      ? "Quote held: includes a manually priced electrical fixes item"
      : null;
  if (reason) return { state: "held", reason, status: "draft" };
  return { state: "held", reason: "Waiting for office review before sending", status: "draft" };
}

export function installerPriceRangeReason(pricePerM2: number | null, min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (pricePerM2 == null || !Number.isFinite(pricePerM2) || pricePerM2 <= 0) return "Quote held: installer price per m² could not be checked";
  if (min != null && pricePerM2 < min) return `Quote held: installer price $${pricePerM2.toFixed(2)}/m² is below the normal range`;
  if (max != null && pricePerM2 > max) return `Quote held: installer price $${pricePerM2.toFixed(2)}/m² is above the normal range`;
  return null;
}

export function currentEstimateTotal(scenarios: unknown, removalRequired = false): number | null {
  if (!Array.isArray(scenarios)) return null;
  const scenario = (removalRequired ? scenarios.find((row) => (row as { key?: unknown })?.key === "full_removal") : scenarios.find((row) => (row as { key?: unknown })?.key === "can_remain")) ?? scenarios[0];
  const value = Number((scenario as { by_access?: { standard?: { estimated_customer_total?: unknown } } } | undefined)?.by_access?.standard?.estimated_customer_total);
  return Number.isFinite(value) && value > 0 ? value : null;
}