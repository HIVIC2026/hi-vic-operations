export const LAUNCH_CAMPAIGN = "existing_leads_launch_v1" as const;
export const LAUNCH_BATCH_SIZE = 50;
export const LAUNCH_COPY_APPROVED = false;

export type LaunchGroup = "likely" | "onsite";
export type DeskCheckOutcome = "looks_eligible" | "not_eligible" | "needs_onsite_check";

export function launchGroup(outcome: string | null, insulation: string | null): LaunchGroup | null {
  if (outcome === "likely_eligible" && insulation === "none") return "likely";
  if ((outcome === "likely_eligible" || outcome === "needs_onsite_confirmation") && (insulation === "present" || insulation === "unknown" || insulation === null)) return "onsite";
  return null;
}

export function deskCheckReasonError(outcome: DeskCheckOutcome, reason: string) {
  return outcome === "not_eligible" && reason.trim().length < 3 ? "Add a short reason for the homeowner record." : null;
}

export type SavedPrice = { estimateId: string | null; total: number; discount: number; gross: number; areaM2: number | null; insulation: string | null };

/** The price the owner saw: primary scenario, standard access, from the current indicative estimate row. */
export function savedPriceFromEstimate(row: { id: string; area_m2: number | string | null; insulation_declared: string | null; scenarios: unknown } | null): SavedPrice | null {
  const primary = Array.isArray(row?.scenarios) ? (row!.scenarios[0] as { by_access?: { standard?: { estimated_customer_total?: number; applied_discount?: number; pre_discount_total?: number } } }) : null;
  const st = primary?.by_access?.standard;
  if (!row || !st || st.estimated_customer_total == null) return null;
  return { estimateId: row.id, total: Number(st.estimated_customer_total), discount: Number(st.applied_discount ?? 0), gross: Number(st.pre_discount_total ?? 0), areaM2: row.area_m2 == null ? null : Number(row.area_m2), insulation: row.insulation_declared };
}

const money = (n: number) => `$${Math.floor(n).toLocaleString("en-AU")}`;

/** "Saved at $X (rebate $Y) on {date}", plus a change note when the current estimate differs. */
export function savedPriceLabel(saved: { total: number | null; discount: number | null; savedAt: string | null; estimateId?: string | null }, current?: { estimateId: string | null; total: number } | null) {
  if (saved.total == null || !saved.savedAt) return null;
  const date = new Date(saved.savedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" });
  const text = `Saved at ${money(saved.total)} (rebate ${money(saved.discount ?? 0)}) on ${date}`;
  const changed = !!current && (Math.floor(current.total) !== Math.floor(saved.total) || (!!saved.estimateId && !!current.estimateId && current.estimateId !== saved.estimateId && Math.floor(current.total) !== Math.floor(saved.total)));
  return { text, changed, changeNote: changed ? "Estimate has changed since" : null };
}
