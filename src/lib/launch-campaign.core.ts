import { sendKindFromKey } from "./save-spot-delivery.core";

export const LAUNCH_CAMPAIGN = "existing_leads_launch_v1" as const;
export const LAUNCH_BATCH_SIZE = 50;
// Jo approved the Save my spot email + landing copy (8 Oct 2026): real enquiry links must work.
export const LAUNCH_COPY_APPROVED = true;

export type LaunchGroup = "likely" | "onsite";
export type DeskCheckOutcome = "looks_eligible" | "not_eligible" | "needs_onsite_check";

/** Office campaign numbers (Jo, 21 Oct): the two existing-leads email versions must never be mixed into one "sent"
 *  figure. "Spots offered" = confirmed Save my spot sends (initial + existing-insulation follow-up) to real homes;
 *  "Insulation details requested" = confirmed Group B sends. Confirmed = the email service accepted the send ("sent")
 *  or the outcome is unknown but it may have gone out ("delivered_unrecorded"). TEST (qa_test) copies never count. */
export function campaignSendCounts(rows: { status: string; idempotency_key: string | null; source: string | null }[]) {
  const confirmed = new Set(["sent", "delivered_unrecorded"]);
  let spotsOffered = 0, insulationDetails = 0;
  for (const row of rows) {
    if (row.source === "qa_test" || !confirmed.has(row.status)) continue;
    if (sendKindFromKey(row.idempotency_key) === "insulation_details") insulationDetails++;
    else spotsOffered++;
  }
  return { spotsOffered, insulationDetails };
}

export function campaignSaveAllowed(group: LaunchGroup, deskStatus: string | null | undefined, ownerQualified = false) {
  if (group === "likely") return true;
  if (deskStatus === "not_eligible" || deskStatus === "needs_onsite_check") return false;
  return deskStatus === "looks_eligible" || ownerQualified;
}

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

/** Saved-price snapshot from what the owner calculator showed (whatIfEstimate standard scenario). */
export function savedPriceFromCalculator(est: { scenarios: { by_access: { standard: { estimated_customer_total: number; applied_discount: number; pre_discount_total: number } } }[] } | null, areaM2: number, insulation: string | null): SavedPrice | null {
  const st = est?.scenarios[0]?.by_access.standard;
  if (!st) return null;
  return { estimateId: null, total: Number(st.estimated_customer_total), discount: Number(st.applied_discount ?? 0), gross: Number(st.pre_discount_total ?? 0), areaM2, insulation };
}

const INSULATION_WORDS: Record<string, string> = { none: "none", present: "some there", unknown: "not sure" };
/** Job-history note when the owner changes their ceiling size or insulation answer on their own calculator; null when unchanged. */
export function ownerCalculatorChangeNote(before: { areaM2: number | null; insulation: string | null }, after: { areaM2: number; insulation: string | null }): string | null {
  const parts: string[] = [];
  if (before.areaM2 == null || Math.round(before.areaM2) !== Math.round(after.areaM2)) parts.push(before.areaM2 == null ? `Owner set ceiling size to ${Math.round(after.areaM2)} m² on the calculator` : `Owner changed ceiling size from ${Math.round(before.areaM2)} to ${Math.round(after.areaM2)} m² on the calculator`);
  if (after.insulation && before.insulation !== after.insulation) parts.push(`Owner changed existing-insulation answer${before.insulation ? ` from "${INSULATION_WORDS[before.insulation] ?? before.insulation}"` : ""} to "${INSULATION_WORDS[after.insulation] ?? after.insulation}" on the calculator`);
  return parts.length ? parts.join(". ") : null;
}
