// In-memory PostgREST-style client for server-module tests that need embedded selects ("jobs(stage)",
// "jobs!inner(business_unit)"), embedded-column filters, or(), range() and nullsFirst ordering — none of which the PGlite
// shim supports. Supports only what it implements; anything else throws so a test never passes on a silent no-op.
// To-one embeds resolve by `<singular>_id` on the row (invoices.jobs → invoices.job_id → jobs.id); to-many embeds by
// `<singular of parent>_id` on the child table. Never touches a real database.
type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

const singular = (t: string) => (t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.replace(/s$/, ""));
let seq = 0;
const newId = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;

function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
type Sel = { cols: string[]; star: boolean; embeds: { name: string; inner: boolean; sel: Sel }[] };
function parseSel(s: string): Sel {
  const sel: Sel = { cols: [], star: false, embeds: [] };
  for (const part of splitTop(s)) {
    const m = /^([a-z_]+)(!inner)?\((.*)\)$/s.exec(part);
    if (m) sel.embeds.push({ name: m[1]!, inner: !!m[2], sel: parseSel(m[3]!) });
    else if (part === "*") sel.star = true;
    else sel.cols.push(part);
  }
  return sel;
}

export function memoryPostgrest(tables: Tables) {
  const T = tables;
  const embed = (table: string, row: Row, name: string): Row | Row[] | null => {
    const child = T[name] ?? [];
    const fk = `${singular(name)}_id`;
    if (fk in row) return child.find((c) => c["id"] === row[fk]) ?? null;
    const back = `${singular(table)}_id`;
    return child.filter((c) => c[back] === row["id"]);
  };
  const project = (table: string, row: Row, sel: Sel): Row => {
    const out: Row = sel.star || !sel.cols.length ? { ...row } : Object.fromEntries(sel.cols.map((c) => [c, row[c] ?? null]));
    if (!sel.star && sel.cols.length === 0 && sel.embeds.length) for (const k of Object.keys(out)) delete out[k];
    for (const e of sel.embeds) {
      const v = embed(table, row, e.name);
      out[e.name] = Array.isArray(v) ? v.map((x) => project(e.name, x, e.sel)) : v ? project(e.name, v, e.sel) : null;
    }
    return out;
  };
  const get = (table: string, row: Row, path: string): unknown => {
    if (!path.includes(".")) return row[path];
    const [rel, col] = path.split(".") as [string, string];
    const v = embed(table, row, rel);
    return Array.isArray(v) ? v.map((x) => x[col]) : v ? v[col] : undefined;
  };
  const cmp = (a: unknown, b: unknown) => (a == null ? (b == null ? 0 : -1) : b == null ? 1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  const contains = (have: unknown, want: unknown): boolean => {
    if (want && typeof want === "object") return !!have && typeof have === "object" && Object.entries(want as Row).every(([k, v]) => contains((have as Row)[k], v));
    return have === want;
  };

  return {
    tables: T,
    from(table: string) {
      T[table] ??= [];
      type F = (r: Row) => boolean;
      const filters: F[] = []; const inner: string[] = [];
      let op: "select" | "insert" | "update" = "select"; let payload: Row | Row[] = {}; let sel: Sel | null = null; let wantRows = true;
      let count = false, head = false, single: "one" | "maybe" | null = null; const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
      let lim: number | null = null; let from = 0; let to: number | null = null;
      const b: any = {
        select(c = "*", o?: { count?: string; head?: boolean }) {
          if (op === "select") { sel = parseSel(c); count = o?.count === "exact"; head = !!o?.head; for (const e of sel.embeds) if (e.inner) inner.push(e.name); }
          else { sel = parseSel(c); wantRows = true; }
          return b;
        },
        insert(p: Row | Row[]) { op = "insert"; payload = p; wantRows = false; return b; },
        update(p: Row) { op = "update"; payload = p; wantRows = false; return b; },
        eq(c: string, v: unknown) { filters.push((r) => get(table, r, c) === v); return b; },
        neq(c: string, v: unknown) { filters.push((r) => get(table, r, c) !== v); return b; },
        in(c: string, v: unknown[]) { filters.push((r) => v.includes(get(table, r, c))); return b; },
        is(c: string, v: null) { if (v !== null) throw new Error("memory-postgrest: is() only with null"); filters.push((r) => get(table, r, c) == null); return b; },
        gte(c: string, v: unknown) { filters.push((r) => cmp(get(table, r, c), v) >= 0); return b; },
        gt(c: string, v: unknown) { filters.push((r) => cmp(get(table, r, c), v) > 0); return b; },
        lt(c: string, v: unknown) { filters.push((r) => cmp(get(table, r, c), v) < 0); return b; },
        lte(c: string, v: unknown) { filters.push((r) => cmp(get(table, r, c), v) <= 0); return b; },
        contains(c: string, v: unknown) { filters.push((r) => contains(get(table, r, c), v)); return b; },
        not(c: string, o: string, v: unknown) {
          if (o === "is" && v === null) filters.push((r) => get(table, r, c) != null);
          else if (o === "in" && typeof v === "string") { const vals = v.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim()); filters.push((r) => !vals.includes(String(get(table, r, c)))); }
          else throw new Error(`memory-postgrest: not(${o}) unsupported`);
          return b;
        },
        or(expr: string) {
          const parts = expr.split(",").map((p) => { const [c, o, ...rest] = p.split("."); return { c: c!, o: o!, v: rest.join(".") }; });
          filters.push((r) => parts.some(({ c, o, v }) => o === "is" && v === "null" ? r[c] == null : o === "lt" ? cmp(r[c], v) < 0 : o === "eq" ? String(r[c]) === v : (() => { throw new Error(`memory-postgrest: or(${o}) unsupported`); })()));
          return b;
        },
        order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) { orders.push({ col: c, asc: o?.ascending !== false, nullsFirst: o?.nullsFirst ?? o?.ascending === false }); return b; },
        limit(n: number) { lim = n; return b; },
        range(a: number, z: number) { from = a; to = z; return b; },
        single() { single = "one"; return b; },
        maybeSingle() { single = "maybe"; return b; },
        async run() {
          const all = T[table]!;
          if (op === "insert") {
            const rows = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: newId(), created_at: new Date().toISOString(), ...structuredClone(p) }));
            all.push(...rows);
            const data = wantRows && sel ? rows.map((r) => project(table, r, sel!)) : null;
            return single ? { data: data?.[0] ?? null, error: null } : { data, error: null };
          }
          const hit = all.filter((r) => inner.every((n) => { const v = embed(table, r, n); return Array.isArray(v) ? v.length > 0 : !!v; }) && filters.every((f) => f(r)));
          if (op === "update") {
            for (const r of hit) Object.assign(r, structuredClone(payload));
            const data = wantRows && sel ? hit.map((r) => project(table, r, sel!)) : null;
            return single ? { data: data?.[0] ?? null, error: null } : { data, error: null };
          }
          let rows = [...hit];
          if (orders.length) rows.sort((a, z) => {
            for (const o of orders) {
              const x = a[o.col], y = z[o.col];
              if (x == null || y == null) { if (x == null && y == null) continue; return (x == null) === o.nullsFirst ? -1 : 1; }
              const c = cmp(x, y); if (c) return o.asc ? c : -c;
            }
            return 0;
          });
          const total = rows.length;
          rows = rows.slice(from, to == null ? undefined : to + 1);
          if (lim != null) rows = rows.slice(0, lim);
          if (head) return { data: null, count: total, error: null };
          const data = rows.map((r) => project(table, r, sel ?? parseSel("*")));
          if (single === "one") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `expected one ${table} row, got ${data.length}` } };
          if (single === "maybe") return { data: data[0] ?? null, error: null, ...(count ? { count: total } : {}) };
          return { data, error: null, ...(count ? { count: total } : {}) };
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return b.run().then(res, rej); },
      };
      return b;
    },
    rpc: async (name: string) => { throw new Error(`memory-postgrest: rpc ${name} unsupported`); },
  };
}
