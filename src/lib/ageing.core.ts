// Ageing helpers for the Office dashboard. Ageing is "how long has this been waiting" — it is NOT a deadline.
// There is no SLA in the system, so nothing here may be labelled "overdue".
const DAY = 86_400_000;

/** Whole days since an ISO timestamp (null when it is missing or unreadable). Never negative. */
export function ageDays(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

/** Subtle ageing emphasis: 30+ days red, 14+ days amber, otherwise muted. */
export function ageTone(days: number): string {
  if (days >= 30) return "text-danger font-semibold";
  if (days >= 14) return "text-warning font-semibold";
  return "text-muted-foreground";
}
