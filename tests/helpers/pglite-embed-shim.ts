// PostgREST-style query builder over PGlite WITH embedded resources (`rel(cols)`, `alias:fk(cols)`, `rel!inner(cols)`,
// nested embeds and filters on embedded columns such as `.eq("jobs.business_unit", …)`), so server code that reads
// related rows the way supabase-js does runs against REAL Postgres rows in tests. Relationships are declared by the
// test (table -> embed name -> { table, fk, on }); nothing is guessed. Never touches the live database.
import type { PGlite } from "@electric-sql/pglite";

/** on "base": base.fk = rel.id (many-to-one, returns an object). on "rel": rel.fk = base.id (one-to-many, returns an array). */
export type Rel = { table: string; fk: string; on: "base" | "rel" };
export type Rels = Record<string, Record<string, Rel>>;

type Part = { kind: "col"; name: string } | { kind: "embed"; alias: string; key: string; inner: boolean; parts: Part[] };
type Filter = { col: string; sql: (ref: string, ph: (v: unknown) => string) => string };

function parseSelect(s: string): Part[] {
  const parts: Part[] = []; let depth = 0, cur = "";
  const flush = () => { const t = cur.trim(); cur = ""; if (!t) return; parts.push(partOf(t)); };
  for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { flush(); continue; } cur += ch; }
  flush();
  return parts;
}
function partOf(t: string): Part {
  const open = t.indexOf("(");
  if (open < 0) return { kind: "col", name: t.trim() };
  const head = t.slice(0, open).trim(), body = t.slice(open + 1, t.lastIndexOf(")"));
  const inner = /!inner$/.test(head);
  const h = head.replace(/!inner$/, "");
  const [alias, key] = h.includes(":") ? h.split(":") as [string, string] : [h, h];
  return { kind: "embed", alias, key, inner, parts: parseSelect(body) };
}

/** Split on commas outside parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; } cur += ch; }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}
/** One PostgREST logical filter string → SQL over t0 (eq/neq/gt/gte/lt/lte/is/in/like/ilike/cs, not.*, and()/or()). */
function orSql(expr: string, ph: (v: unknown) => string, join = "OR"): string {
  const one = (t: string): string => {
    const nested = /^(and|or)\((.*)\)$/.exec(t);
    if (nested) return `(${orSql(nested[2]!, ph, nested[1]!.toUpperCase())})`;
    const m = /^([a-z_0-9]+)\.(not\.)?([a-z]+)\.(.*)$/.exec(t);
    if (!m) throw new Error(`embed shim: unsupported or() term ${t}`);
    const [, col, neg, op, raw] = m as unknown as [string, string, string | undefined, string, string];
    const ref = `t0."${col}"`;
    const val = raw.replace(/^"(.*)"$/, "$1");
    let sql: string;
    switch (op) {
      case "eq": sql = `${ref} = ${ph(val)}`; break;
      case "neq": sql = `${ref} <> ${ph(val)}`; break;
      case "gt": sql = `${ref} > ${ph(val)}`; break;
      case "gte": sql = `${ref} >= ${ph(val)}`; break;
      case "lt": sql = `${ref} < ${ph(val)}`; break;
      case "lte": sql = `${ref} <= ${ph(val)}`; break;
      case "like": sql = `${ref}::text LIKE ${ph(val.replace(/\*/g, "%"))}`; break;
      case "ilike": sql = `${ref}::text ILIKE ${ph(val.replace(/\*/g, "%"))}`; break;
      case "is": sql = `${ref} IS ${val === "null" ? "NULL" : val === "true" ? "TRUE" : "FALSE"}`; break;
      case "in": sql = `${ref}::text = ANY(${ph(splitTop(val.replace(/^\(|\)$/g, "")).map((x) => x.replace(/^"(.*)"$/, "$1")))})`; break;
      case "cs": sql = `${ref} @> ${ph(val.startsWith("{") ? val.replace(/^\{|\}$/g, "").split(",") : JSON.parse(val))}`; break;
      default: throw new Error(`embed shim: unsupported or() operator ${op}`);
    }
    return neg ? `NOT (${sql})` : sql;
  };
  return splitTop(expr).map(one).join(` ${join} `);
}

export function embedShim(db: PGlite, rels: Rels, options: { jsonColumns?: Record<string, string[]> } = {}) {
  const q = (c: string) => `"${c}"`;
  let n = 0;
  const rel = (table: string, e: { alias: string; key: string }) => {
    const r = rels[table]?.[e.alias] ?? rels[table]?.[e.key] ?? Object.values(rels[table] ?? {}).find((x) => x.fk === e.key);
    if (!r) throw new Error(`embed shim: no relationship declared for ${table}.${e.alias}`);
    return r;
  };
  const join = (r: Rel, baseRef: string, relRef: string) => (r.on === "base" ? `${relRef}."id" = ${baseRef}.${q(r.fk)}` : `${relRef}.${q(r.fk)} = ${baseRef}."id"`);
  const cols = (table: string, ref: string, parts: Part[]): string =>
    parts.map((p) => {
      if (p.kind === "col") return p.name === "*" ? `${ref}.*` : `${ref}.${q(p.name)}`;
      const r = rel(table, p); const sub = `e${++n}`;
      const inner = `SELECT ${cols(r.table, sub, p.parts)} FROM ${r.table} ${sub} WHERE ${join(r, ref, sub)}`;
      return r.on === "base" ? `(SELECT row_to_json(x) FROM (${inner} LIMIT 1) x) AS ${q(p.alias)}` : `(SELECT coalesce(json_agg(x), '[]'::json) FROM (${inner}) x) AS ${q(p.alias)}`;
    }).join(", ");

  return {
    from(table: string) {
      let op: "select" | "update" | "insert" | "delete" = "select"; let conflict: string | null = null; let ignoreDup = false; let orderBy = ""; let lim = "";
      let selectStr = "*"; let patch: Record<string, unknown> | Record<string, unknown>[] = {}; let returning: string | null = null;
      const filters: Filter[] = []; let single: "one" | "maybe" | null = null; let head = false; let wantCount = false;
      const add = (col: string, f: (ref: string, ph: (v: unknown) => string) => string) => { filters.push({ col, sql: f }); return b; };
      const b = {
        select(c = "*", o?: { count?: string; head?: boolean }) { if (op !== "select") returning = c; else { selectStr = c; head = !!o?.head; wantCount = o?.count === "exact"; } return b; },
        update(p: Record<string, unknown>) { op = "update"; patch = p; return b; },
        eq: (c: string, v: unknown) => add(c, (r, ph) => `${r} = ${ph(v)}`),
        neq: (c: string, v: unknown) => add(c, (r, ph) => `${r} <> ${ph(v)}`),
        gte: (c: string, v: unknown) => add(c, (r, ph) => `${r} >= ${ph(v)}`),
        gt: (c: string, v: unknown) => add(c, (r, ph) => `${r} > ${ph(v)}`),
        lt: (c: string, v: unknown) => add(c, (r, ph) => `${r} < ${ph(v)}`),
        lte: (c: string, v: unknown) => add(c, (r, ph) => `${r} <= ${ph(v)}`),
        is: (c: string, v: null | boolean) => add(c, (r) => `${r} IS ${v === null ? "NULL" : v ? "TRUE" : "FALSE"}`),
        contains: (c: string, v: unknown) => add(c, (r, ph) => `${r} @> ${ph(JSON.stringify(v))}::jsonb`),
        ilike: (c: string, v: string) => add(c, (r, ph) => `${r} ILIKE ${ph(v)}`),
        like: (c: string, v: string) => add(c, (r, ph) => `${r} LIKE ${ph(v)}`),
        match(o: Record<string, unknown>) { for (const [c, v] of Object.entries(o)) add(c, (r, ph) => `${r} = ${ph(v)}`); return b; },
        overlaps: (c: string, v: unknown[]) => add(c, (r, ph) => `${r} && ${ph(v)}`),
        /** PostgREST `or` filter string ("a.eq.1,b.is.null,and(c.gt.2,d.lt.3)") on base-table columns. */
        or(expr: string, o?: { referencedTable?: string; foreignTable?: string }) {
          if (o?.referencedTable || o?.foreignTable) return b; // filters on an embedded table only narrow the embed; not modelled
          filters.push({ col: "__or__", sql: (_r, ph) => orSql(expr, ph) });
          return b;
        },
        range(from: number, to: number) { lim = ` LIMIT ${Number(to) - Number(from) + 1} OFFSET ${Number(from)}`; return b; },
        returns() { return b; },
        abortSignal() { return b; },
        throwOnError() { return b; },
        in: (c: string, v: unknown[]) => add(c, (r, ph) => `${r} = ANY(${ph(v)})`),
        not(c: string, o: string, v: unknown) {
          if (o === "is" && v === null) return add(c, (r) => `${r} IS NOT NULL`);
          if (o === "in" && typeof v === "string") { const list = v.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim()); return add(c, (r, ph) => `NOT (${r} = ANY(${ph(list)}))`); }
          throw new Error("embed shim: unsupported not()");
        },
        insert(p: Record<string, unknown> | Record<string, unknown>[]) { op = "insert"; patch = p; return b; },
        upsert(p: Record<string, unknown>, o?: { onConflict?: string; ignoreDuplicates?: boolean }) { op = "insert"; patch = p; conflict = o?.onConflict ?? "id"; ignoreDup = !!o?.ignoreDuplicates; return b; },
        delete() { op = "delete"; return b; },
        order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string }) {
          if (o?.referencedTable || o?.foreignTable || c.includes("(")) return b;
          orderBy = `${orderBy ? `${orderBy},` : " ORDER BY"} t0.${q(c)} ${o?.ascending === false ? "DESC" : "ASC"}${o?.nullsFirst === true ? " NULLS FIRST" : o?.nullsFirst === false ? " NULLS LAST" : ""}`;
          return b;
        },
        limit(x: number) { lim = ` LIMIT ${Number(x)}`; return b; },
        single() { single = "one"; return b; },
        maybeSingle() { single = "maybe"; return b; },
        async run() {
          const vals: unknown[] = [];
          const ph = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
          const enc = (k: string, v: unknown) => (v !== null && (typeof v === "object" || options.jsonColumns?.[table]?.includes(k)) ? JSON.stringify(v) : v);
          const parts = op === "select" ? parseSelect(selectStr) : [];
          const embeds = parts.filter((p): p is Extract<Part, { kind: "embed" }> => p.kind === "embed");
          const where = (phFn: (v: unknown) => string = ph) => {
            const conds: string[] = [];
            for (const f of filters) {
              if (f.col === "__or__") { conds.push(f.sql("t0", phFn)); continue; }
              const dot = f.col.indexOf(".");
              if (dot < 0) { conds.push(f.sql(`t0.${q(f.col)}`, phFn)); continue; }
              const [alias, col] = [f.col.slice(0, dot), f.col.slice(dot + 1)];
              const e = embeds.find((x) => x.alias === alias) ?? { alias, key: alias, inner: false, parts: [] };
              const r = rel(table, e); const sub = `w${++n}`;
              conds.push(`EXISTS (SELECT 1 FROM ${r.table} ${sub} WHERE ${join(r, "t0", sub)} AND ${f.sql(`${sub}.${q(col)}`, phFn)})`);
            }
            for (const e of embeds) if (e.inner && !filters.some((f) => f.col.startsWith(`${e.alias}.`))) { const r = rel(table, e); const sub = `w${++n}`; conds.push(`EXISTS (SELECT 1 FROM ${r.table} ${sub} WHERE ${join(r, "t0", sub)})`); }
            return conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
          };
          let sql: string;
          const ret = () => (returning === "*" ? "*" : returning ? returning.split(",").map((c) => q(c.trim())).join(", ") : "1");
          if (op === "insert") {
            const rowsIn = (Array.isArray(patch) ? patch : [patch]) as Record<string, unknown>[];
            const ks = Object.keys(rowsIn[0] ?? {});
            const tuples = rowsIn.map((p) => `(${ks.map((k) => ph(enc(k, p[k]))).join(", ")})`);
            const oc = conflict ? ` ON CONFLICT (${conflict.split(",").map((c) => q(c.trim())).join(", ")}) ${ignoreDup ? "DO NOTHING" : `DO UPDATE SET ${ks.map((k) => `${q(k)} = EXCLUDED.${q(k)}`).join(", ")}`}` : "";
            sql = `INSERT INTO ${table} (${ks.map(q).join(", ")}) VALUES ${tuples.join(", ")}${oc} RETURNING ${ret()}`;
          } else if (op === "update") {
            const sets = Object.entries(patch as Record<string, unknown>).map(([k, v]) => `${q(k)} = ${ph(enc(k, v))}`);
            sql = `UPDATE ${table} t0 SET ${sets.join(", ")}${where()} RETURNING ${ret()}`;
          } else if (op === "delete") sql = `DELETE FROM ${table} t0${where()} RETURNING ${ret()}`;
          else sql = `SELECT ${head ? "count(*)::int AS n" : cols(table, "t0", parts)} FROM ${table} t0${where()}${orderBy}${lim}`;
          try {
            const r = await db.query<Record<string, unknown>>(sql, vals);
            const rows = r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
            if (head) return { data: null, count: (rows[0]?.n as number) ?? 0, error: null };
            let count: number | null = null;
            if (op === "select" && wantCount) {
              const cv: unknown[] = [];
              const w = where((v) => { cv.push(v); return `$${cv.length}`; });
              count = Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} t0${w}`, cv)).rows[0]?.n ?? 0);
            }
            if (single === "one") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `not exactly one row (${rows.length}) from ${table}` } };
            if (single === "maybe") return { data: rows[0] ?? null, error: null, ...(count != null ? { count } : {}) };
            return { data: op !== "select" && !returning ? null : rows, error: null, ...(count != null ? { count } : {}) };
          } catch (e) {
            if (process.env["SHIM_DEBUG"]) console.error(`[shim] ${(e as Error).message} :: ${sql.slice(0, 300)}`);
            return { data: null, error: { message: `${(e as Error).message} [${sql}]`, code: (e as { code?: string }).code } };
          }
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return b.run().then(res, rej); },
      };
      return b;
    },
  };
}
