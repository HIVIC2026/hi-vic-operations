/** Pure helpers shared by the ineligible outcome email path. No data access or delivery. The old preliminary
 *  ineligible renderer was removed on 24 Oct 2026 (replaced by the approved O6 Not eligible email). */

/** Keeps only a short, plain customer-safe reason (no markup or internal review codes). */
export function safeReason(r: string | null | undefined): string | null {
  if (!r) return null;
  const t = r.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!t || /[_]{1}[a-z]+_/.test(t) || /review required/i.test(t)) return null;
  return t.slice(0, 400);
}
