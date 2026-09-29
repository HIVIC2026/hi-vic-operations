// Minimal in-memory stand-in for the service-role client used by the pre-lock QA tests.
// Supports the query shapes used by followups/engagement/referral/estimatelink servers only.
type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;
export const uniques: Record<string, string[]> = {
  customer_email_sends: ["idempotency_key"],
  customer_referral_events: ["dedupe_key"],
  customer_engagement_events: ["dedupe_key"],
  customer_followups: ["job_id,slot"],
};
let seq = 0;
export const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function fakeDb(tables: Tables, rpc: Record<string, (args: any) => any> = {}) {
  const t = (n: string) => (tables[n] ??= []);
  function builder(name: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: any = null; let opts: any = {}; let order: [string, boolean] | null = null; let lim: number | null = null; let returning = false;
    const dup = (r: Row) => (uniques[name] ?? []).some((cols) => t(name).some((x) => cols.split(",").every((c) => r[c] != null && x[c] === r[c])));
    const run = () => {
      if (op === "insert" || op === "upsert") {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: id(), created_at: new Date().toISOString(), status: name === "customer_email_sends" ? "sending" : name === "customer_referral_tokens" ? "active" : r.status ?? "pending", attempts: 0, ...r }));
        const out: Row[] = [];
        for (const r of rows) {
          if (dup(r)) { if (op === "upsert" && opts.ignoreDuplicates) continue; return { data: null, error: { message: "duplicate key value violates unique constraint" } }; }
          t(name).push(r); out.push(r);
        }
        return { data: out, error: null };
      }
      let rows = t(name).filter((r) => filters.every((f) => f(r)));
      if (op === "update") { for (const r of rows) Object.assign(r, payload); return { data: rows.map((r) => ({ ...r })), error: null }; }
      if (order) rows = [...rows].sort((a, b) => (a[order![0]] > b[order![0]] ? 1 : -1) * (order![1] ? 1 : -1));
      if (lim != null) rows = rows.slice(0, lim);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const b: any = {
      select: (_c?: string) => { if (op !== "select") returning = true; return b; },
      insert: (p: any) => { op = "insert"; payload = p; return b; },
      upsert: (p: any, o: any) => { op = "upsert"; payload = p; opts = o ?? {}; return b; },
      update: (p: any) => { op = "update"; payload = p; return b; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return b; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return b; },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { order = [c, o?.ascending !== false]; return b; },
      limit: (n: number) => { lim = n; return b; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return r.error ? r : r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "no rows" } }; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    void returning;
    return b;
  }
  return {
    from: (n: string) => builder(n),
    rpc: async (n: string, a: any) => (rpc[n] ? { data: await rpc[n]!(a), error: null } : { data: null, error: null }),
  };
}
