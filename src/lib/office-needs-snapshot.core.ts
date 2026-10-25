// Decision 382 (Jo 25 Oct 2026: "still extremely slow and unusable"): Needs me opens from a saved copy that the server
// refreshes in the background, instead of ~380 reads (≈3.3 s on the live database) on every open. Pure rules only.
export const NEEDS_FRESH_MS = 60_000;          // younger than this: just serve it
export const NEEDS_MAX_SERVE_MS = 20 * 60_000; // older than this: too old to show — work it out now
export const NEEDS_REFRESH_CLAIM_MS = 2 * 60_000; // one background refresh at a time; a stuck claim expires
export const needsSnapshotKey = (includeTest: boolean) => (includeTest ? "test" : "live");

export type NeedsSnapshotPlan = "serve" | "serve_and_refresh" | "compute_now";

/** What to do with the saved copy: `ageMs` null = none saved. `force` = the office just acted on a row. */
export function needsSnapshotPlan(ageMs: number | null, force = false): NeedsSnapshotPlan {
  if (ageMs == null || ageMs < 0 || ageMs > NEEDS_MAX_SERVE_MS) return "compute_now";
  return force || ageMs > NEEDS_FRESH_MS ? "serve_and_refresh" : "serve";
}

/** "just now" / "3 min ago" (+ " · updating…" while the server refreshes the copy). */
export function checkedLabel(computedAt: string, refreshing: boolean, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(computedAt).getTime()) / 60_000));
  return (mins < 1 ? "just now" : `${mins} min ago`) + (refreshing ? " · updating…" : "");
}
