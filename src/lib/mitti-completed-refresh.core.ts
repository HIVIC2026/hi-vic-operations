// Completed Ready Check edits update declared measurements, never issued quote scope or verified measurements.
export function completedRefreshPlan(i: { current: { id: string; status: string | null; external_source: string | null; external_id: string | null; raw_snapshot?: unknown; accepted_by?: string | null; verified_area_m2?: unknown }; auditId: string; completed: boolean; snapshot: unknown; values: Record<string, unknown>; zones: unknown[] | null }) {
  const m = i.current;
  if (!i.completed || m.status !== "complete" || m.external_source !== "mitti" || m.external_id !== i.auditId || m.accepted_by || m.verified_area_m2 != null) return null;
  if (JSON.stringify(m.raw_snapshot ?? null) === JSON.stringify(i.snapshot)) return null;
  // A cleared form answer must not leave the old removal or access facts behind.
  const fields = ["measured_area_m2", "insulation_present", "existing_r_value", "removal_required", "removal_m2", "access_difficulty"];
  const values = Object.fromEntries(fields.map(k => [k, i.values[k] ?? null]));
  if (values.removal_required === false) values.removal_m2 = null;
  return { ...values, raw_snapshot: i.snapshot, zones: i.zones ?? [] };
}

export function completedQuoteCanRedraft(quotes: { status: string; sent_at?: string | null; release_state?: string | null }[]): boolean {
  return !quotes.some(q => q.status === "issued" || q.status === "accepted" || !!q.sent_at || (q.status === "draft" && q.release_state !== "held"));
}