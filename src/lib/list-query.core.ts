/**
 * PostgREST fragments shared by every server-paginated Office list.
 *
 * Pure functions only (no React, no database client) so the generated query text can be unit
 * tested. Every list loader composes these in the same order — filter -> search -> sort -> page —
 * and only the rows for the requested page are ever serialised to the browser.
 */

/**
 * PostgREST `in`/`not.in` values are comma separated, and `ilike` treats `*` and `_` as wildcards, so
 * none of these can survive into a search term. They become a space rather than an escape: a dropped
 * character can only widen a search, never break the query or reach another column.
 */
const UNSAFE = /[%*,()._\\]/g;

/**
 * Split a typed search into words. Characters that would break an `or=(...)` / `and=(...)` value are
 * dropped rather than escaped, and the list is capped so a pasted paragraph cannot build a huge query.
 */
export function searchWords(term: unknown, limit = 8): string[] {
  if (typeof term !== "string") return [];
  return term
    .replace(UNSAFE, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * `or=(job_number.ilike.*bob*,owner_name.ilike.*bob*)` – the database matches the term, so the browser
 * never sees rows the office did not ask for. Several words widen the result (any word may match),
 * never narrow it, so a multi-word search can never hide a record. Returns null when there is nothing
 * to search for, which lets callers skip the filter entirely.
 */
export function searchFilter(term: unknown, columns: string[]): string | null {
  const words = searchWords(term);
  if (!words.length || !columns.length) return null;
  return words.flatMap((w) => columns.map((c) => `${c}.ilike.*${w}*`)).join(",");
}

/**
 * Exclusion lists travel in `not.in.(...)`. Long lists are split into several `not.in` clauses so a
 * single request never builds an over-long URL.
 */
export function notInChunks(ids: string[], chunkSize = 150): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) out.push(`(${ids.slice(i, i + chunkSize).join(",")})`);
  return out;
}

/** Direction is always one of two values, whatever the URL claims. */
export const toDirection = (v: unknown): "asc" | "desc" => (v === "asc" ? "asc" : "desc");

/**
 * Whitelisted values only — a column name or enum taken from the URL is never interpolated blind.
 * Anything unrecognised falls back, so a stale or hand-edited link can never widen or break a query.
 */
export function toEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T | null): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** `head: true` counts return no rows, so the count comes from the response header. */
export function countOf(res: { count: number | null; error: { message: string } | null }, what: string): number {
  if (res.error) throw new Error(`${what} unavailable: ${res.error.message}`);
  return res.count ?? 0;
}

/** A zero-row page must still report page 1 of 1, never page 1 of 0. */
export function pageMeta(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  return { page: current, pageSize: Math.max(1, pageSize), total, totalPages, current };
}
