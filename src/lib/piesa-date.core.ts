// ONE PIESA assessment-date rule, shared by every write path (manual portal entry, completeAssessment,
// and the Mitti import). Pure: no database, no clock of its own — callers pass `today` so tests are exact.
//
// Why this file exists: the Mitti-only path recorded "PIESA date cannot be in the future.", but the S64
// manual entry path wrote assessments.assessed_on with no such guard. A future date silently stretched the
// 30-day installation deadline (e.g. assessing "in 3 days" gave a 33-day window), which is a compliance
// number, not a cosmetic one.
import { melbourneToday } from "./melbourne-time.core";

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PIESA_DATE_IN_FUTURE = "PIESA date cannot be in the future.";
export const PIESA_DATE_INVALID = "Enter a valid PIESA assessment date (YYYY-MM-DD).";

/** Calendar validity, not just shape: 2026-02-30 is a shape-valid non-date. */
export function isValidYmd(ymd: string | null | undefined): ymd is string {
  if (typeof ymd !== "string" || !YMD_RE.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The single rejection test. `today` is the authoritative Australia/Melbourne calendar date. */
export function piesaDateInFuture(ymd: string, today: string): boolean {
  return ymd > today; // YYYY-MM-DD sorts lexicographically, so a plain string compare IS the date compare
}

/** Blockers for a user-supplied assessment date. Empty array = accepted. */
export function piesaDateBlockers(ymd: string | null | undefined, today: string = melbourneToday()): string[] {
  if (!isValidYmd(ymd)) return [PIESA_DATE_INVALID];
  if (piesaDateInFuture(ymd, today)) return [PIESA_DATE_IN_FUTURE];
  return [];
}

export type PiesaDateImport = { patch: Record<string, unknown>; issues: string[] };

/**
 * External data (Mitti) import: the rule is the same, but a bad external value must not abort the whole
 * sync. The offending field is dropped and reported as a review issue so the office sees exactly what was
 * refused. Historical values already stored are never rewritten by this function.
 */
export function refuseFuturePiesaDate<T extends Record<string, unknown>>(patch: T, today: string = melbourneToday()): PiesaDateImport {
  const raw: unknown = patch["assessed_on"];
  if (raw === undefined || raw === null) return { patch, issues: [] };
  const ad = typeof raw === "string" ? raw : String(raw);
  if (isValidYmd(ad) && !piesaDateInFuture(ad, today)) return { patch, issues: [] };
  const { assessed_on: _dropped, ...rest } = patch;
  void _dropped;
  return {
    patch: rest as T,
    issues: [`Mitti assessment date "${ad}" was refused: ${isValidYmd(ad) ? PIESA_DATE_IN_FUTURE : PIESA_DATE_INVALID} Enter the date in the portal instead.`],
  };
}
