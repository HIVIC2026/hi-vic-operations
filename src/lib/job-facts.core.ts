// Speed (portal speed step 2 part A, Task 11): the installer job page used to make ~150 small database reads, and the
// portal's server lets only 6 wait at a time. The page now reads every row of this one job ONCE (`loadJobFacts`, one
// request) and answers each section's own query from those rows. This file is the pure part: given the job's rows and the
// exact query a section built (`.from(t).select(..).eq(..).order(..)...`), give the answer the database would give — or
// `null` when it can't be sure, and the section's query then goes to the database exactly as before.
// Rules that keep the answer identical: only this job's rows (the query must be scoped to this job id); only simple filters
// (eq, neq, in, is, contains), orders on dates/numbers/true-false, limit, maybeSingle/single; a column the rows don't have
// (missing live) goes to the database so it errors as before; anything else goes to the database.

/** Tables read whole for the job (`<table>.job_id = job`); `jobs` itself is the job's own row. */
export const JOB_FACT_TABLES = [
  "workflow_events", "bookings", "job_assignments", "quotes", "ceiling_measurements", "piesa_records", "assessments",
  "appointment_proposals", "customer_assignments", "installer_declarations", "rectification_items", "invoices",
  "payment_overrides", "ready_check_windows", "assessment_payments", "owner_esc_consents", "ready_checks", "worker_job_links",
] as const;
export type JobFactTable = (typeof JOB_FACT_TABLES)[number];

/**
 * Rows embedded under a fact table's rows (read with them through the named foreign key), usable as embeds in a section's
 * select. `cols` other than "*" are the only columns read: a section asking for more (or `*`) goes to the database.
 * Each is exactly what a section of the job page already reads about this job.
 */
export type Nest = { readonly name: string; readonly fk?: string; readonly via?: string; readonly cols: string };
export const NESTED: Readonly<Record<string, readonly Nest[]>> = {
  jobs: [{ name: "properties", fk: "jobs_property_id_fkey", cols: "*" }],
  quotes: [{ name: "quote_items", cols: "*" }, { name: "quote_internals", cols: "*" }],
  bookings: [{ name: "businesses", fk: "bookings_business_id_fkey", cols: "name, trading_name" }],
  // `profiles:user_id(full_name)`: the assigned person's name, embedded through the row's user_id (PostgREST column hint).
  job_assignments: [{ name: "businesses", fk: "job_assignments_business_id_fkey", cols: "in_house" }, { name: "profiles", via: "user_id", cols: "full_name" }],
  worker_job_links: [{ name: "partner_workers", fk: "worker_job_links_worker_id_fkey", cols: "full_legal_name, trade_role" }],
  partner_workers: [{ name: "businesses", fk: "partner_workers_business_id_fkey", cols: "name" }],
};
const nestSel = (t: string) => (NESTED[t] ?? []).map((n) => `, ${n.name}${n.via ? `:${n.via}` : n.fk ? `!${n.fk}` : ""}(${n.cols})`).join("");

/** One select for the whole job: the job row (with its property) plus each fact table through its job foreign key. */
export const JOB_FACTS_SELECT = [`*${nestSel("jobs")}`, ...JOB_FACT_TABLES.map((t) => `${t}!${t}_job_id_fkey(*${nestSel(t)})`)].join(", ");

/** The caller's own business (already verified by the access check): its row, people and activations. */
export const BUSINESS_FACT_TABLES = ["partner_workers", "business_members", "partner_activations"] as const;
export const BUSINESS_FACTS_SELECT = ["*", ...BUSINESS_FACT_TABLES.map((t) => `${t}!${t}_business_id_fkey(*${nestSel(t)})`)].join(", ");

type Row = Record<string, unknown>;
/** Rows of one table, all of them for one scope value (`col = value`): a query must filter on exactly that to be answered. */
export type FactTable = { readonly rows: readonly Row[]; readonly scope: { readonly col: string; readonly value: string } };
export type Facts = Readonly<Record<string, FactTable>>;

const asRows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v && typeof v === "object" ? [v as Row] : []);

/** The one-select answer for a job, as fact tables: `jobs` (the job's row) and each job table (a one-to-one embed comes back as an object). */
export function jobFactsFrom(jobId: string, data: Row): Facts {
  const job: Row = { ...data };
  const out: Record<string, FactTable> = {};
  for (const t of JOB_FACT_TABLES) { out[t] = { rows: asRows(data[t]), scope: { col: "job_id", value: jobId } }; delete job[t]; }
  out["jobs"] = { rows: [job], scope: { col: "id", value: jobId } };
  return out;
}

/** The one-select answer for a business: `businesses` (its row), its partner workers and its members. */
export function businessFactsFrom(businessId: string, data: Row): Facts {
  const biz: Row = { ...data };
  const out: Record<string, FactTable> = {};
  for (const t of BUSINESS_FACT_TABLES) { out[t] = { rows: asRows(data[t]), scope: { col: "business_id", value: businessId } }; delete biz[t]; }
  out["businesses"] = { rows: [biz], scope: { col: "id", value: businessId } };
  return out;
}

/** A single settings row (`workflow_settings`, id 1). */
export function settingsFactsFrom(data: Row): Facts {
  return { workflow_settings: { rows: [data], scope: { col: "id", value: "1" } } };
}

export type QueryOp = { m: string; a: unknown[] };
/** Same shape as a postgrest-js response. */
export type FactsAnswer = { success: true; data: unknown; error: null; count: number | null; status: number; statusText: string };

const COL = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATEISH = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const prim = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

type Sel = { star: boolean; cols: string[]; embeds: { name: string; sel: Sel }[] };
function splitTop(s: string): string[] | null {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return null;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (depth !== 0) return null;
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSel(s: string, embeddable: readonly Nest[]): Sel | null {
  const parts = splitTop(s.replace(/\s+/g, " "));
  if (!parts || !parts.length) return null;
  const sel: Sel = { star: false, cols: [], embeds: [] };
  for (const p of parts) {
    if (p === "*") { sel.star = true; continue; }
    if (COL.test(p)) { sel.cols.push(p); continue; }
    // `name(...)`, or `name:column(...)` exactly as the facts read it (`via`).
    const e = /^([a-z_]+)(?::([a-z_]+))?\((.*)\)$/s.exec(p);
    const nest = e ? embeddable.find((n) => n.name === e[1] && (e[2] ?? null) === (n.via ?? null)) : undefined;
    if (!e || !nest) return null;
    const inner = parseSel(e[3]!, []);
    if (!inner || (inner.star && nest.cols !== "*")) return null;
    if (nest.cols !== "*") { const have = nest.cols.split(",").map((c) => c.trim()); if (!inner.cols.every((c) => have.includes(c))) return null; }
    sel.embeds.push({ name: e[1]!, sel: inner });
  }
  return sel;
}

/** Same value for a filter: strings exactly (uuids ignoring case, as Postgres does); dates never (format may differ). */
function same(have: unknown, want: unknown): boolean | null {
  if (have === null || have === undefined) return false;
  if (!prim(want)) return null;
  if (typeof have === "string") {
    if (DATEISH.test(have)) return null;
    const w = String(want);
    return UUID.test(have) && UUID.test(w) ? have.toLowerCase() === w.toLowerCase() : have === w;
  }
  if (typeof have === "number") { const n = typeof want === "number" ? want : Number(want); return typeof want === "boolean" || Number.isNaN(n) ? null : have === n; }
  if (typeof have === "boolean") return String(have) === String(want);
  return null;
}
function contains(have: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  if (want && typeof want === "object") return !!have && typeof have === "object" && !Array.isArray(have) && Object.entries(want as Row).every(([k, v]) => contains((have as Row)[k], v));
  return have === want;
}

/** Sort key for an ordered column: numbers, true/false, dates/timestamps (by instant, then sub-millisecond digits) or uuids.
 *  A column must hold one kind (a mix goes to the database). */
type Key = { kind: "num" | "bool" | "date" | "uuid"; n: number; sub: string } | null;
function keyOf(v: unknown): Key | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return { kind: "num", n: v, sub: "" };
  if (typeof v === "boolean") return { kind: "bool", n: v ? 1 : 0, sub: "" };
  if (typeof v === "string" && DATEISH.test(v)) {
    const frac = /\.(\d+)/.exec(v)?.[1] ?? "";
    const ms = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v.replace(" ", "T"));
    if (Number.isNaN(ms)) return undefined;
    return { kind: "date", n: ms, sub: frac.slice(3).padEnd(6, "0") };
  }
  // A uuid sorts by its bytes in Postgres, which is the order of its lowercase hex text.
  if (typeof v === "string" && UUID.test(v)) return { kind: "uuid", n: 0, sub: v.toLowerCase() };
  return undefined; // text order depends on the database's collation: let the database answer
}

const clone = <T,>(v: T): T => (v === null || typeof v !== "object" ? v : (JSON.parse(JSON.stringify(v)) as T));

function project(row: Row, sel: Sel): Row {
  const out: Row = sel.star ? clone(row) : {};
  for (const e of sel.embeds) delete out[e.name];
  for (const c of sel.cols) out[c] = clone(row[c]);
  for (const e of sel.embeds) {
    const v = row[e.name];
    out[e.name] = Array.isArray(v) ? v.map((x) => project(x as Row, e.sel)) : v && typeof v === "object" ? project(v as Row, e.sel) : null;
  }
  return out;
}

/**
 * The database's answer to `ops` on `table`, from the facts' rows — or null (ask the database). The query must filter on
 * the table's scope (`.eq(col, value)` or `.in(col, [value])`), e.g. `jobs` by id, a job table by `job_id`.
 */
export function answerFromFacts(facts: Facts, table: string, ops: readonly QueryOp[]): FactsAnswer | null {
  const t = facts[table];
  return t ? answer(t, NESTED[table] ?? [], ops, false) : null;
}

/** Whether the query's shape could be answered from a table with this scope at all (then it waits for the facts;
 *  otherwise it goes to the database at once, so a query the facts can't answer never waits). */
export function factsCanTry(table: string, scope: FactTable["scope"], ops: readonly QueryOp[]): boolean {
  return answer({ rows: [], scope }, NESTED[table] ?? [], ops, true) !== null;
}

function answer(t: FactTable, nested: readonly Nest[], ops: readonly QueryOp[], shapeOnly: boolean): FactsAnswer | null {
  const all = t.rows;
  const [first, ...rest] = ops;
  if (!first || first.m !== "select" || first.a.length > 2) return null;
  // `{ count: "exact" }` adds the row count; `head: true` returns only the count (data null), as postgrest-js does.
  const selOpt = (first.a[1] ?? {}) as Record<string, unknown>;
  if (typeof selOpt !== "object" || selOpt === null || Object.keys(selOpt).some((k) => !(k === "count" && selOpt[k] === "exact") && !(k === "head" && typeof selOpt[k] === "boolean"))) return null;
  const withCount = selOpt["count"] === "exact", head = selOpt["head"] === true;
  if (head && !withCount) return null;
  const sel = parseSel(first.a.length ? String(first.a[0]) : "*", nested);
  if (!sel) return null;
  const scopeCol = t.scope.col, scopeVal = t.scope.value.toLowerCase();
  const sample = all[0];
  const has = (c: string) => !sample || Object.prototype.hasOwnProperty.call(sample, c);
  if (![...sel.cols, ...sel.embeds.map((e) => e.name)].every(has)) return null;
  // Embedded rows: their columns must exist too (checked on the first embedded row met).
  if (sel.embeds.length && sample) {
    for (const e of sel.embeds) {
      const inner = all.flatMap((r) => { const v = r[e.name]; return Array.isArray(v) ? v : v ? [v] : []; })[0] as Row | undefined;
      if (inner && !e.sel.cols.every((c) => Object.prototype.hasOwnProperty.call(inner, c))) return null;
    }
  }

  const filters: ((r: Row) => boolean | null)[] = [];
  const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  let limit: number | null = null;
  let offset: number | null = null;
  let one: "maybe" | "single" | null = null;
  let scoped = false;
  for (const op of rest) {
    if (one) return null; // nothing may follow maybeSingle/single
    const [c, v] = op.a as [string, unknown];
    if (["eq", "neq", "in", "is", "contains", "order", "not"].includes(op.m) && (typeof c !== "string" || !COL.test(c) || !has(c))) return null;
    switch (op.m) {
      case "eq":
        if (op.a.length !== 2) return null;
        if (c === scopeCol && prim(v) && String(v).toLowerCase() === scopeVal) scoped = true;
        filters.push((r) => same(r[c], v));
        break;
      case "neq":
        if (op.a.length !== 2) return null;
        filters.push((r) => { if (r[c] === null || r[c] === undefined) return false; const s = same(r[c], v); return s === null ? null : !s; });
        break;
      case "in": {
        if (op.a.length !== 2 || !Array.isArray(v) || !v.every(prim)) return null;
        if (c === scopeCol && v.length === 1 && String(v[0]).toLowerCase() === scopeVal) scoped = true;
        filters.push((r) => { let unsure = false; for (const w of v) { const s = same(r[c], w); if (s) return true; if (s === null) unsure = true; } return unsure ? null : false; });
        break;
      }
      case "not": {
        // PostgREST `col=not.<op>.<value>`: only `is null`, `eq` and `in (a,b)`; a NULL never passes `not eq` / `not in`.
        const [, nop, nv] = op.a as [string, unknown, unknown];
        if (op.a.length !== 3) return null;
        if (nop === "is" && (nv === null || nv === "null")) { filters.push((r) => r[c] !== null && r[c] !== undefined); break; }
        let vals: unknown[];
        if (nop === "eq" && prim(nv)) vals = [nv];
        else if (nop === "in" && typeof nv === "string" && /^\(.*\)$/s.test(nv) && !nv.includes('"')) vals = nv.slice(1, -1).split(",").map((x) => x.trim());
        else return null;
        filters.push((r) => { if (r[c] === null || r[c] === undefined) return false; for (const w of vals) { const s2 = same(r[c], w); if (s2 === null) return null; if (s2) return false; } return true; });
        break;
      }
      case "is":
        if (op.a.length !== 2 || !(v === null || v === true || v === false)) return null;
        filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v));
        break;
      case "contains":
        if (op.a.length !== 2 || !v || typeof v !== "object") return null;
        filters.push((r) => { const h = r[c]; if (h === null || h === undefined) return false; return typeof h === "object" ? contains(h, v) : null; });
        break;
      case "order": {
        if (op.a.length > 2) return null;
        if (op.a.length === 2 && (typeof v !== "object" || v === null)) return null;
        const o = (v ?? {}) as Record<string, unknown>;
        if (Object.keys(o).some((k) => k !== "ascending" && k !== "nullsFirst")) return null;
        const asc = o["ascending"] !== false;
        orders.push({ col: c, asc, nullsFirst: typeof o["nullsFirst"] === "boolean" ? (o["nullsFirst"] as boolean) : !asc });
        break;
      }
      case "range": {
        // supabase-js `range(from, to)`: offset `from`, at most `to - from + 1` rows.
        const [from, to] = op.a as [unknown, unknown];
        if (op.a.length !== 2 || limit !== null || offset !== null || typeof from !== "number" || typeof to !== "number" || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return null;
        offset = from; limit = to - from + 1;
        break;
      }
      case "limit":
        if (limit !== null) return null;
        if (op.a.length !== 1 || typeof op.a[0] !== "number" || !Number.isInteger(op.a[0]) || (op.a[0] as number) < 0) return null;
        limit = op.a[0] as number;
        break;
      case "maybeSingle": one = "maybe"; break;
      case "single": one = "single"; break;
      case "returns": break;
      default: return null;
    }
  }
  if (!scoped) return null;

  let rows: Row[] = [];
  for (const r of all) {
    let keep = true;
    for (const f of filters) { const ok = f(r); if (ok === null) return null; if (!ok) { keep = false; break; } }
    if (keep) rows.push(r);
  }
  if (orders.length) {
    const keyed: { r: Row; k: Key[] }[] = [];
    const kinds: (string | undefined)[] = [];
    for (const r of rows) {
      const k: Key[] = [];
      for (let i = 0; i < orders.length; i++) {
        const kk = keyOf(r[orders[i]!.col]);
        if (kk === undefined) return null;
        if (kk) { const seen = kinds[i]; if (seen && seen !== kk.kind) return null; kinds[i] = kk.kind; }
        k.push(kk);
      }
      keyed.push({ r, k });
    }
    keyed.sort((x, y) => {
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]!, a = x.k[i]!, b = y.k[i]!;
        if (a === null || b === null) { if (a === b) continue; return (a === null) === o.nullsFirst ? -1 : 1; }
        const d = a.n !== b.n ? a.n - b.n : a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0;
        if (d !== 0) return o.asc ? d : -d;
      }
      return 0;
    });
    rows = keyed.map((x) => x.r);
  }
  if (offset !== null) rows = rows.slice(offset);
  if (limit !== null) rows = rows.slice(0, limit);
  if (head) return one || limit !== null || offset !== null ? null : { success: true, data: null, error: null, count: rows.length, status: 200, statusText: "OK" };
  if (withCount && (one || limit !== null || offset !== null)) return null; // count with limit/single: let the database give its own numbers
  const out = rows.map((r) => project(r, sel));
  if (one) {
    // More than one row (or none for single) is a database error: let the database give it, word for word.
    if (out.length > 1 || (one === "single" && out.length === 0 && !shapeOnly)) return null;
    return { success: true, data: out[0] ?? null, error: null, count: null, status: 200, statusText: "OK" };
  }
  return { success: true, data: out, error: null, count: withCount ? out.length : null, status: 200, statusText: "OK" };
}
