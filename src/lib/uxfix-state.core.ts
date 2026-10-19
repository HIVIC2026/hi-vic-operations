// UX-defect fix helpers (D-3 / D-4): pure display-state decisions and copy.
// They do NOT change any business rule, database value or workflow — they only decide
// what a page shows when a query is still loading, failed, or returned no configuration.
export const OWNER_JOB_UNAVAILABLE_MESSAGE =
  "This job is not available. If you believe this is a mistake, please contact us.";

export const PRICING_MISSING_TITLE = "Owner pricing is not configured yet.";
export const PRICING_MISSING_DESC =
  "No current owner price row is set up, so new quotes and estimates cannot be generated. Set the owner prices and the current VEEC buy/sale price in the database before continuing. No prices are invented here.";

export type PricingQueryState = {
  error?: unknown;
  isLoading: boolean;
  hasCurrent: boolean;
};

/** D-3: distinguish "still loading" from "loaded but missing pricing configuration". */
export function pricingLoadState(q: PricingQueryState): "error" | "loading" | "missing" | "ready" {
  if (q.error) return "error";
  if (q.isLoading) return "loading";
  if (!q.hasCurrent) return "missing";
  return "ready";
}

export type JobQueryState = {
  error?: unknown;
  hasData: boolean;
};

/** D-4: a failed owner job lookup is "unavailable" (generic), never a spinner. */
export function jobLoadState(q: JobQueryState): "unavailable" | "loading" | "ready" {
  if (q.error) return "unavailable";
  if (!q.hasData) return "loading";
  return "ready";
}
