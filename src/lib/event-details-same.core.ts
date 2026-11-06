// Duplicate guard for append-only job-history events.
// The database returns jsonb with keys sorted at every depth, while freshly built
// details keep code insertion order — a plain JSON.stringify comparison therefore
// always reports "changed" and the sync logs an identical event every run.
// Comparing canonical (recursively key-sorted) JSON makes identical content equal
// regardless of key order.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** True when a previous event's details and the new details carry the same content. */
export function sameEventDetails(previous: unknown, next: unknown): boolean {
  return canonicalJson(previous ?? null) === canonicalJson(next ?? null);
}
