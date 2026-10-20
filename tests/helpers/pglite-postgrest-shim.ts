// Minimal PostgREST-style query builder over PGlite so server code that uses supabaseAdmin conditional
// updates (eq/is/in/neq + select) runs against REAL Postgres row locking in tests. Never touches the live database.
import type { PGlite } from "@electric-sql/pglite";

type Filter = { sql: string; vals: unknown[] };
export function postgrestShim(db: PGlite) {
  return {
    from(table: string) {
      let op: "select" | "update" | "insert" = "select"; let orderBy = ""; let lim = "";
      let cols = "*"; let patch: Record<string, unknown> = {}; let returning: string | null = null;
      const filters: Filter[] = []; let single: "one" | "maybe" | null = null; let head = false; let wantCount = false;
      const b = {
        select(c = "*", o?: { count?: string; head?: boolean }) { if (op !== "select") returning = c; else { cols = c; head = !!o?.head; wantCount = o?.count === "exact"; } return b; },
        update(p: Record<string, unknown>) { op = "update"; patch = p; return b; },
        eq(c: string, v: unknown) { filters.push({ sql: `"${c}" = $?`, vals: [v] }); return b; },
        neq(c: string, v: unknown) { filters.push({ sql: `"${c}" <> $?`, vals: [v] }); return b; },
        is(c: string, v: null) { filters.push({ sql: `"${c}" IS ${v === null ? "NULL" : "NOT NULL"}`, vals: [] }); return b; },
        contains(c: string, v: unknown) { filters.push({ sql: `"${c}" @> $?::jsonb`, vals: [JSON.stringify(v)] }); return b; },
        ilike(c: string, v: string) { filters.push({ sql: `"${c}" ILIKE $?`, vals: [v] }); return b; },
        in(c: string, v: unknown[]) { filters.push({ sql: `"${c}" = ANY($?)`, vals: [v] }); return b; },
        insert(p: Record<string, unknown>) { op = "insert"; patch = p; return b; },
        order(c: string, o?: { ascending?: boolean }) { orderBy = ` ORDER BY "${c}" ${o?.ascending === false ? "DESC" : "ASC"}`; return b; },
        limit(n: number) { lim = ` LIMIT ${Number(n)}`; return b; },
        single() { single = "one"; return b; },
        maybeSingle() { single = "maybe"; return b; },
        async run() {
          const vals: unknown[] = []; const ph = (s: string, vs: unknown[]) => s.replace(/\$\?/g, () => { vals.push(vs.shift()); return `$${vals.length}`; });
          let sql: string;
          if (op === "insert") {
            const rowsIn = (Array.isArray(patch) ? patch : [patch]) as Record<string, unknown>[];
            const ks = Object.keys(rowsIn[0] ?? {});
            const tuples = rowsIn.map((p) => `(${ks.map((k) => { const v = p[k]; vals.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v); return `$${vals.length}`; }).join(", ")})`);
            sql = `INSERT INTO ${table} (${ks.map((k) => `"${k}"`).join(", ")}) VALUES ${tuples.join(", ")} RETURNING ${returning === "*" ? "*" : returning ? returning.split(",").map((c) => `"${c.trim()}"`).join(", ") : "1"}`;
          } else if (op === "update") {
            const sets = Object.entries(patch).map(([k, v]) => { vals.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v); return `"${k}" = $${vals.length}`; });
            sql = `UPDATE ${table} SET ${sets.join(", ")}`;
          } else sql = `SELECT ${head ? "count(*)::int AS n" : cols === "*" ? "*" : cols.split(",").map((c) => `"${c.trim()}"`).join(", ")} FROM ${table}`;
          if (op !== "insert" && filters.length) sql += " WHERE " + filters.map((f) => ph(f.sql, [...f.vals])).join(" AND ");
          if (op === "select") sql += orderBy + lim;
          if (op === "update") sql += ` RETURNING ${returning === "*" ? "*" : returning ? returning.split(",").map((c) => `"${c.trim()}"`).join(", ") : "1"}`;
          try {
            const r = await db.query<Record<string, unknown>>(sql, vals);
            const rows = r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
            if (head) return { data: null, count: (rows[0]?.n as number) ?? 0, error: null };
            // PostgREST returns the exact total (ignoring LIMIT) when count: "exact" is requested on a normal select.
            let count: number | null = null;
            if (op === "select" && wantCount) {
              const cv: unknown[] = []; const cph = (s2: string, vs: unknown[]) => s2.replace(/\$\?/g, () => { cv.push(vs.shift()); return `$${cv.length}`; });
              const where = filters.length ? " WHERE " + filters.map((f) => cph(f.sql, [...f.vals])).join(" AND ") : "";
              count = Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}${where}`, cv)).rows[0]?.n ?? 0);
            }
            if (single === "one") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not exactly one row" } };
            if (single === "maybe") return { data: rows[0] ?? null, error: null, ...(count != null ? { count } : {}) };
            return { data: op !== "select" && !returning ? null : rows, error: null, ...(count != null ? { count } : {}) };
          } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return b.run().then(res, rej); },
      };
      return b;
    },
    rpc: async () => ({ data: true, error: null }),
  };
}
