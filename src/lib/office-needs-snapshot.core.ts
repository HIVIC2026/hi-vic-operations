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

// Decision 383 (Jo 25 Oct 2026, same complaint): the DEFAULT first page of Jobs › Active and of Enquiries (no search,
// no filter, default sort, page 1, no TEST jobs) is served the same way, from the same server-only table under its own
// key. Any other view reads live. After an office action the next open works it out now (never a stale row).
export const LIST_SNAPSHOT_KEYS = { jobs: "jobs_active:first", enquiries: "enquiries:first" } as const;

/** Lists: like Needs me, except `force` (the office just changed something) works the page out now. */
export function listSnapshotPlan(ageMs: number | null, force = false): NeedsSnapshotPlan {
  return force ? "compute_now" : needsSnapshotPlan(ageMs);
}

/** True only for a filter with no content at all (a blank-looking " " still reads live). */
function emptyFilter(f: unknown): boolean {
  if (f == null) return true;
  if (typeof f !== "object" || Array.isArray(f)) return false;
  return Object.values(f as Record<string, unknown>).every((v) =>
    v == null || v === false || v === "" || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every((x) => x == null)));
}

type ListView = { search: string; sort: string; page: number; filters?: unknown; includeTest?: boolean | undefined; view?: string | undefined; wantIds?: boolean | undefined };
/** The one view that has a saved copy: what the screen shows when it opens. */
export function isDefaultListView(p: ListView): boolean {
  // Enquiries: the opening category is "offered" (Offered a spot, Jo 28 Oct 2026); a list of every id is never cached.
  return p.search === "" && p.sort === "" && p.page === 1 && !p.includeTest && emptyFilter(p.filters) && (!p.view || p.view === "offered") && !p.wantIds;
}
