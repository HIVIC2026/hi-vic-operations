// One rule for a job-page panel's read (Jo, 27 Oct 2026): a read that FAILED must say so — never look empty
// ("0 documents", every record unrecorded) or "Loading…" forever. A failed background refetch keeps rows already shown.
// PURE: presentation only.
export type PanelLoad = "failed" | "loading" | "ready";

export function panelLoad(q: { error: unknown; data: unknown }): PanelLoad {
  // TanStack Query leaves data undefined until a read succeeds; null is a real answer ("no row").
  if (q.data !== undefined) return "ready";
  return q.error ? "failed" : "loading";
}

/** Supabase browser reads return their error instead of throwing; throw it so the query shows as failed. */
export function readOrThrow<R extends { data: unknown; error: { message: string } | null }>(r: R): R["data"] {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
