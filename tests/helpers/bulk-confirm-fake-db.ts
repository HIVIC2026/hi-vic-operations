// In-memory stand-in for the service client, just enough PostgREST surface for bulk-import confirmation.
// Unique keys mirror the live database (jobs.external_enquiry_id, documents(job_id,source_system,external_id)).
// Fault injection: `failNext(table, op, mode)` — "error" returns an error with no write; "uncertain" WRITES the row but
// reports an error (lost response), so retries must recover without duplicating. No network, fake TEST data only.
type Row = Record<string, unknown>;
type Mode = "error" | "uncertain";

export function fakeDb() {
  const tables: Record<string, Row[]> = {};
  const faults: { table: string; op: string; mode: Mode; skip: number }[] = [];
  let seq = 0;
  const t = (n: string) => (tables[n] ??= []);
  const uniq: Record<string, (r: Row) => string | null> = {
    jobs: (r) => (r.external_enquiry_id ? String(r.external_enquiry_id) : null),
    documents: (r) => (r.external_id ? `${r.job_id}|${r.source_system}|${r.external_id}` : null),
    owner_eligibility_links: (r) => String(r.token_hash),
  };
  function from(table: string) {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] = {}; let head = false; let wantCount = false; let lim: number | null = null; let mode: "one" | "maybe" | null = null;
    const preds: ((r: Row) => boolean)[] = [];
    const b: Record<string, unknown> = {
      select(_c?: string, o?: { count?: string; head?: boolean }) { if (o?.head) head = true; if (o?.count) wantCount = true; return b; },
      insert(p: Row | Row[]) { op = "insert"; payload = p; return b; },
      update(p: Row) { op = "update"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return b; },
      neq(c: string, v: unknown) { preds.push((r) => r[c] !== v); return b; },
      is(c: string, v: null) { preds.push((r) => (r[c] ?? null) === v); return b; },
      in(c: string, v: unknown[]) { preds.push((r) => v.includes(r[c])); return b; },
      ilike(c: string, v: string) { preds.push((r) => String(r[c] ?? "").toLowerCase() === v.replace(/\\/g, "").toLowerCase()); return b; },
      or(expr: string) {
        const parts = expr.split(",").map((p) => { const [c, o, ...rest] = p.split("."); return { c: c!, o: o!, v: rest.join(".") }; });
        preds.push((r) => parts.some(({ c, o, v }) => (o === "is" && v === "null" ? r[c] == null : o === "lt" ? r[c] != null && String(r[c]) < v : false)));
        return b;
      },
      order() { return b; },
      limit(n: number) { lim = n; return b; },
      single() { mode = "one"; return b; },
      maybeSingle() { mode = "maybe"; return b; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    function run(): { data: unknown; error: { message: string; code?: string } | null; count?: number } {
      const fi = faults.findIndex((f) => f.table === table && f.op === op);
      let fault = fi >= 0 ? faults[fi]! : null;
      if (fault && fault.skip > 0) { fault.skip--; fault = null; } else if (fault) faults.splice(fi, 1);
      if (fault?.mode === "error") return { data: null, error: { message: `injected ${op} failure on ${table}` } };
      const rows = t(table);
      let out: Row[] = [];
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const p of list) {
          const r: Row = { id: `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...(table === "jobs" ? { job_number: `HV-T${seq}` } : {}), ...p };
          const k = uniq[table]?.(r);
          if (k && rows.some((x) => uniq[table]!(x) === k)) return { data: null, error: { message: "duplicate key", code: "23505" } };
          rows.push(r); out.push(r);
        }
      } else {
        out = rows.filter((r) => preds.every((p) => p(r)));
        if (op === "update") out.forEach((r) => Object.assign(r, payload));
        if (op === "delete") tables[table] = rows.filter((r) => !out.includes(r));
      }
      if (fault?.mode === "uncertain") return { data: null, error: { message: `injected lost response on ${table}` } };
      if (op === "select" && table === "jobs") out = out.map((r) => ({ ...r, properties: t("properties").find((p) => p.id === r.property_id) ?? null }));
      if (lim != null) out = out.slice(0, lim);
      if (head) return { data: null, error: null, count: out.length };
      if (mode === "one") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "no row" } };
      if (mode === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null, ...(wantCount ? { count: out.length } : {}) };
    }
    return b;
  }
  return {
    tables, t, from,
    reset() { for (const k of Object.keys(tables)) delete tables[k]; faults.length = 0; },
    failNext(table: string, op: string, mode: Mode = "error", skip = 0) { faults.push({ table, op, mode, skip }); },
    storage: { from: () => ({}) },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "installer@hivic-test.example", user_metadata: { qa_test: true } } } }) } },
  };
}
