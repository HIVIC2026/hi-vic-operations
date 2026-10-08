// Minimal PostgREST-style query builder over PGlite so server code that uses supabaseAdmin conditional
// updates (eq/is/in/neq + select) runs against REAL Postgres row locking in tests. Never touches the live database.
import type { PGlite } from "@electric-sql/pglite";

type Filter = { sql: string; vals: unknown[] };
export function postgrestShim(db: PGlite) {
  return {
    from(table: string) {
      let op: "select" | "update" = "select";
      let cols = "*"; let patch: Record<string, unknown> = {}; let returning: string | null = null;
      const filters: Filter[] = []; let single: "one" | "maybe" | null = null; let head = false;
      const b = {
        select(c = "*", o?: { count?: string; head?: boolean }) { if (op === "update") returning = c; else { cols = c; head = !!o?.head; } return b; },
        update(p: Record<string, unknown>) { op = "update"; patch = p; return b; },
        eq(c: string, v: unknown) { filters.push({ sql: `"${c}" = $?`, vals: [v] }); return b; },
        neq(c: string, v: unknown) { filters.push({ sql: `"${c}" <> $?`, vals: [v] }); return b; },
        is(c: string, v: null) { filters.push({ sql: `"${c}" IS ${v === null ? "NULL" : "NOT NULL"}`, vals: [] }); return b; },
        in(c: string, v: unknown[]) { filters.push({ sql: `"${c}" = ANY($?)`, vals: [v] }); return b; },
        single() { single = "one"; return b; },
        maybeSingle() { single = "maybe"; return b; },
        async run() {
          const vals: unknown[] = []; const ph = (s: string, vs: unknown[]) => s.replace(/\$\?/g, () => { vals.push(vs.shift()); return `$${vals.length}`; });
          let sql: string;
          if (op === "update") {
            const sets = Object.entries(patch).map(([k, v]) => { vals.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v); return `"${k}" = $${vals.length}`; });
            sql = `UPDATE ${table} SET ${sets.join(", ")}`;
          } else sql = `SELECT ${head ? "count(*)::int AS n" : cols === "*" ? "*" : cols.split(",").map((c) => `"${c.trim()}"`).join(", ")} FROM ${table}`;
          if (filters.length) sql += " WHERE " + filters.map((f) => ph(f.sql, [...f.vals])).join(" AND ");
          if (op === "update") sql += ` RETURNING ${returning ? returning.split(",").map((c) => `"${c.trim()}"`).join(", ") : "1"}`;
          try {
            const r = await db.query<Record<string, unknown>>(sql, vals);
            const rows = r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
            if (head) return { data: null, count: (rows[0]?.n as number) ?? 0, error: null };
            if (single === "one") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not exactly one row" } };
            if (single === "maybe") return { data: rows[0] ?? null, error: null };
            return { data: op === "update" && !returning ? null : rows, error: null };
          } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return b.run().then(res, rej); },
      };
      return b;
    },
    rpc: async () => ({ data: true, error: null }),
  };
}
