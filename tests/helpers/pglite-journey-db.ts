// Isolated in-process PostgreSQL (PGlite) holding EVERY table of the portal, generated from the Supabase types
// (`src/integrations/supabase/types.ts`): one column per Row field (text / double precision / boolean / jsonb / text[] /
// timestamptz for *_at, date for *_date), `id` primary keys with gen_random_uuid() defaults, defaults for the Insert-optional
// NOT NULL columns, and every declared foreign key as an embed relationship for the PostgREST-style shim. Views are plain
// empty tables. Used by the A1/A2 journey tests so the REAL server modules read and write real rows without a hand-written
// schema per step. Constraints the generated types cannot express (unique idempotency keys) are added by `extraSql`.
// Never touches the live database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { embedShim, type Rels } from "./pglite-embed-shim";

type Col = { name: string; ts: string; optional: boolean };
type Fk = { columns: string[]; isOneToOne: boolean; ref: string };
type Table = { name: string; cols: Col[]; fks: Fk[]; view: boolean };

/** Parse `Database["public"]["Tables" | "Views"]` (Row + Insert optionality + Relationships) from the generated types. */
export function parseSupabaseTypes(src = readFileSync(new URL("../../src/integrations/supabase/types.ts", import.meta.url), "utf8")): { tables: Table[]; enums: Record<string, string[]> } {
  const lines = src.split("\n");
  const tables: Table[] = [];
  let section: "tables" | "views" | "other" = "other", block = "", cur: Table | null = null, fk: Partial<Fk> | null = null, pendingCol: Col | null = null;
  const insertOptional = new Map<string, Set<string>>();
  for (const l of lines) {
    if (l === "    Tables: {") { section = "tables"; continue; }
    if (l === "    Views: {") { section = "views"; continue; }
    if (l === "    Functions: {" || l === "    Enums: {" || l === "    CompositeTypes: {") { section = "other"; continue; }
    if (section === "other") continue;
    let m: RegExpExecArray | null;
    if ((m = /^      ([a-z_0-9]+): \{$/.exec(l))) { cur = { name: m[1]!, cols: [], fks: [], view: section === "views" }; tables.push(cur); insertOptional.set(cur.name, new Set()); continue; }
    if (!cur) continue;
    if ((m = /^        (Row|Insert|Update|Relationships): [{[]$/.exec(l))) { block = m[1]!; continue; }
    // A union type can wrap onto the following lines ("name:" then "  | A" / "  | null"): fold them back on.
    if (block === "Row" && pendingCol && (m = /^            \| (.+)$/.exec(l))) { pendingCol.ts = pendingCol.ts ? `${pendingCol.ts} | ${m[1]}` : m[1]!; continue; }
    pendingCol = null;
    if (block === "Row" && (m = /^          ([a-z_0-9]+):$/.exec(l))) { pendingCol = { name: m[1]!, ts: "", optional: false }; cur.cols.push(pendingCol); continue; }
    if (block === "Row" && (m = /^          ([a-z_0-9]+): (.+)$/.exec(l))) { cur.cols.push({ name: m[1]!, ts: m[2]!, optional: false }); continue; }
    if (block === "Insert" && (m = /^          ([a-z_0-9]+)\?:/.exec(l))) { insertOptional.get(cur.name)!.add(m[1]!); continue; }
    if (block === "Relationships") {
      if (/^          \{$/.test(l)) fk = {};
      else if (fk && (m = /^            columns: \[(.*)\]$/.exec(l))) fk.columns = m[1]!.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
      else if (fk && (m = /^            isOneToOne: (true|false)$/.exec(l))) fk.isOneToOne = m[1] === "true";
      else if (fk && (m = /^            referencedRelation: "([a-z_0-9]+)"$/.exec(l))) fk.ref = m[1]!;
      else if (fk && /^          \},?$/.test(l)) { if (fk.columns?.length === 1 && fk.ref) cur.fks.push(fk as Fk); fk = null; }
    }
    if (/^        [}\]],?$/.test(l)) block = "";
  }
  for (const t of tables) { const opt = insertOptional.get(t.name)!; for (const c of t.cols) c.optional = opt.has(c.name); }
  // Enums: first value is used as the default for optional NOT NULL enum columns.
  const enums: Record<string, string[]> = {};
  const start = src.indexOf("    Enums: {");
  const enumSrc = src.slice(start, src.indexOf("    CompositeTypes: {", start));
  for (const m of enumSrc.matchAll(/^      ([a-z_0-9]+):((?:\s*\|?\s*"[^"]*")+)/gm)) enums[m[1]!] = [...m[2]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
  return { tables, enums };
}

const TIME_NAMES = /(_at|^at|_start|_end|_until|^starts_at|^ends_at|_from_ts)$/;
// Real live defaults (from the migrations / pending SQL) for the columns the journeys rely on; anything else optional and
// NOT NULL gets a neutral default (false / 0 / enum first value / NULL for free text).
const TEXT_DEFAULTS: Record<string, string> = {
  "customer_estimate_links.status": "active", "customer_estimate_links.purpose": "step3_estimate", "partner_offers.status": "pending", "partner_offers.kind": "ready_check",
  "appointment_proposals.status": "proposed", "assessments.status": "scheduled", "ceiling_measurements.provenance": "unknown", "customer_agreements.status": "signed",
  "customer_agreements.record_origin": "portal", "job_communications.delivery_status": "recorded", "job_communications.provider": "manual", "job_communications.visibility": "internal",
  "job_communications.body": "", "jobs.source": "website", "jobs.customer_relationship_owner": "hivic", "jobs.measure_up_responsibility": "hivic", "properties.state": "VIC",
  "piesa_records.kind": "initial", "rectification_items.status": "open", "rectification_items.source": "piesa", "ready_checks.status": "draft", "esc_notifications.status": "draft",
  "veec_lodgements.status": "draft", "electrician_rates.status": "active", "business_members.member_role": "member", "businesses.onboarding_status": "draft", "businesses.commercial_route": "standard",
  "businesses.default_comms_owner": "hivic", "businesses.xero_contact_status": "not_ready", "partner_workers.account_status": "awaiting_account", "partner_workers.approval_status": "pending",
  "owner_esc_consents.status": "draft", "owner_esc_consents.delivery_status": "pending", "invoices.part": "full", "owner_contact_consents.source": "portal", "install_holds.status": "held",
  "instalment_plans.status": "draft", "ready_check_windows.status": "open", "visit_events.counts_against": "none", "evidence_requirements.status": "required", "external_action_outbox.status": "pending",
  "post_intake_work.status": "pending", "post_intake_work.work_type": "post_intake", "official_form_signed_copies.status": "stored", "official_form_deliveries.channel": "email",
};
/** `*_id` columns that hold provider/external identifiers, not uuids. */
const NON_UUID_ID = /^(external|mitti|provider|xero|submission|template|referred_external|entity|row_id|lease_id)|mitti/;
const TRUE_BOOLEANS = new Set(["active", "is_active", "is_current", "required", "critical", "blocking", "prices_include_gst", "gst_included"]);
const NUMBER_DEFAULTS: Record<string, number> = { version: 1, batch: 1, instalment_count: 3, max_uses: 1 };

/** Column types exactly as the migration chain declares them (CREATE TABLE lines, ADD COLUMN, ALTER COLUMN … TYPE; later
 *  wins), normalised to what PGlite can hold. The generated types only say "number" / "string"; the views and SQL functions
 *  need the real ones (date arithmetic, integer settings). Unknown columns fall back to the type heuristics. */
export function migrationColumnTypes(enumNames: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const STOP = /^\s+(not\s+null|null|default|primary|references|unique|check|constraint|generated|collate)\b/i;
  const norm = (raw: string): string | null => {
    let t = raw.trim().replace(/^public\./i, "").replace(/"/g, "");
    let depth = 0, end = t.length;
    for (let i = 0; i < t.length; i++) { const ch = t[i]!; if (ch === "(") depth++; if (ch === ")") depth--; if (depth === 0 && /\s/.test(ch) && STOP.test(t.slice(i))) { end = i; break; } }
    t = t.slice(0, end).trim().toLowerCase();
    const arr = /\[\]$/.test(t); const base = t.replace(/\[\]$/, "").replace(/\(.*\)$/, "").trim();
    const map: Record<string, string> = { int: "integer", int4: "integer", integer: "integer", smallint: "integer", serial: "integer", bigint: "bigint", int8: "bigint", bigserial: "bigint",
      numeric: "numeric", decimal: "numeric", "double precision": "double precision", float8: "double precision", real: "double precision",
      text: "text", varchar: "text", "character varying": "text", citext: "text", uuid: "uuid", boolean: "boolean", bool: "boolean", jsonb: "jsonb", json: "jsonb",
      date: "date", timestamptz: "timestamptz", "timestamp with time zone": "timestamptz", timestamp: "timestamp", "timestamp without time zone": "timestamp", time: "text", inet: "text", bytea: "bytea", interval: "interval" };
    const m = map[base] ?? (enumNames.has(base) ? `public."${base}"` : null);
    return m ? `${m}${arr ? "[]" : ""}` : null;
  };
  const splitTop = (s: string) => { const r: string[] = []; let d = 0, cur = "", q = false; for (const ch of s) { if (ch === "'") q = !q; if (!q && (ch === "(" || ch === "[")) d++; if (!q && (ch === ")" || ch === "]")) d--; if (!q && ch === "," && d === 0) { r.push(cur); cur = ""; continue; } cur += ch; } if (cur.trim()) r.push(cur); return r; };
  const dirs = [new URL("../../drizzle/migrations/", import.meta.url), new URL("../../docs/pending-migrations/", import.meta.url)];
  for (const dir of dirs) for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && !/rollback/i.test(x)).sort()) {
    const src = readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, "");
    for (const t of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
      for (const colDef of splitTop(t[2]!)) {
        const m = /^\s*"?([a-z_0-9]+)"?\s+([\s\S]+)$/i.exec(colDef);
        if (!m || /^(constraint|primary|unique|check|foreign|exclude|like)$/i.test(m[1]!)) continue;
        const ty = norm(m[2]!); if (ty) out.set(`${t[1]}.${m[1]!.toLowerCase()}`, ty);
      }
    }
    for (const a of src.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+([\s\S]*?);/gi)) {
      for (const part of splitTop(a[2]!)) {
        const add = /^\s*ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?\s+([\s\S]+)$/i.exec(part);
        if (add) { const ty = norm(add[2]!); if (ty) out.set(`${a[1]}.${add[1]!.toLowerCase()}`, ty); continue; }
        const alt = /^\s*ALTER\s+COLUMN\s+"?([a-z_0-9]+)"?\s+(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+?)(\s+USING\b[\s\S]*)?$/i.exec(part);
        if (alt) { const ty = norm(alt[2]!); if (ty) out.set(`${a[1]}.${alt[1]!.toLowerCase()}`, ty); }
      }
    }
  }
  return out;
}

export function journeySchemaSql(): { sql: string; rels: Rels } {
  const { tables, enums } = parseSupabaseTypes();
  const declared = migrationColumnTypes(new Set(Object.keys(enums)));
  const out: string[] = ["CREATE SEQUENCE IF NOT EXISTS journey_job_number START 3300;", "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
    // Supabase's auth schema as the SQL functions see it: the service role has no auth.uid().
    "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key, email text);",
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
    "CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;",
    // Enum names exist as text domains so the real SQL functions' casts (`::job_stage`) and signatures compile.
    ...Object.keys(enums).map((e) => `CREATE DOMAIN public."${e}" AS text;`)];
  const rels: Rels = {};
  for (const t of tables) {
    const fkCols = new Set(t.fks.map((f) => f.columns[0]!));
    const defs = t.cols.map((c) => {
      const ts = c.ts.replace(/\s*\|\s*null$/, "");
      const isEnum = /Database\["public"\]\["Enums"\]\["([a-z_0-9]+)"\]/.exec(ts)?.[1];
      let type = "text", def: string | null = null;
      if (ts === "number") type = "double precision";
      else if (ts === "boolean") type = "boolean";
      else if (ts === "Json") type = "jsonb";
      else if (ts === "string[]") type = "text[]";
      else if (ts === "number[]") type = "double precision[]";
      else if (ts === "string" && TIME_NAMES.test(c.name)) type = "timestamptz";
      // Dates stay text ("YYYY-MM-DD" as PostgREST returns them; compares correctly as text).
      const nullable = c.ts.endsWith("| null");
      if (type === "text" && (fkCols.has(c.name) || (c.name.endsWith("_id") && !NON_UUID_ID.test(c.name)))) type = "uuid";
      // The migration chain's own type wins (only between compatible families, so a stale declaration can't break a column).
      const mig = declared.get(`${t.name}.${c.name}`);
      const family = (x: string) => /^(integer|bigint|numeric|double precision)$/.test(x) ? "number" : /^(date|timestamptz|timestamp|text|uuid)$/.test(x) || x.startsWith("public.") ? "string" : x;
      if (mig && (family(mig) === family(type) || (family(type) === "string" && mig.startsWith("public.")))) type = mig;
      if (c.name === "id" && (type === "text" || type === "uuid")) return `"id" uuid primary key default gen_random_uuid()`;
      if (c.optional && !nullable) {
        const key = `${t.name}.${c.name}`;
        if (c.name === "created_at" || c.name === "updated_at" || type === "timestamptz") def = "clock_timestamp()";
        else if (key === "jobs.job_number") def = "('HV-' || nextval('journey_job_number'))";
        else if (type === "boolean") def = TRUE_BOOLEANS.has(c.name) ? "true" : "false";
        else if (type === "double precision") def = String(NUMBER_DEFAULTS[c.name] ?? 0);
        else if (type === "jsonb") def = /s$|_ids$|zones|items|flags/.test(c.name) ? "'[]'::jsonb" : "'{}'::jsonb";
        else if (type === "text[]") def = "'{}'::text[]";
        else if (isEnum) def = `'${(TEXT_DEFAULTS[key] ?? enums[isEnum]?.[0] ?? "").replace(/'/g, "''")}'`;
        else if (TEXT_DEFAULTS[key] != null) def = `'${TEXT_DEFAULTS[key]!.replace(/'/g, "''")}'`;
      }
      return `"${c.name}" ${type}${def ? ` default ${def}` : ""}`;
    });
    out.push(`CREATE TABLE IF NOT EXISTS public."${t.name}" (${defs.join(", ")});`);
    for (const f of t.fks) {
      const col = f.columns[0]!;
      (rels[t.name] ??= {});
      // Many-to-one: embed by referenced table name, by the FK column and by the column minus _id (first declaration wins).
      for (const name of [f.ref, col, col.replace(/_id$/, "")]) rels[t.name]![name] ??= { table: f.ref, fk: col, on: "base" };
      // One-to-many from the referenced table (isOneToOne still returns an array here; callers that need an object read [0]).
      (rels[f.ref] ??= {});
      rels[f.ref]![t.name] ??= { table: t.name, fk: col, on: "rel" };
    }
  }
  return { sql: out.join("\n"), rels };
}

/** Columns the server code writes/reads that the checked-in generated types do not list yet (live schema is ahead of
 *  types.ts). Each one is named here so a test failure on an unknown column stays visible rather than auto-created. */
export const COLUMNS_MISSING_FROM_TYPES: Record<string, string[]> = {
};

/** Unique constraints/indexes from the applied migration chain and the pending migrations (best effort: each statement
 *  is tried on its own and skipped if it names something the generated schema lacks). Idempotency keys rely on these. */
export function uniqueConstraintSql(): string[] {
  const out: string[] = [];
  const dirs = [new URL("../../drizzle/migrations/", import.meta.url), new URL("../../docs/pending-migrations/", import.meta.url)];
  for (const dir of dirs) for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && !/rollback/i.test(x)).sort()) {
    const src = readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, "");
    for (const m of src.matchAll(/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)\s+ON\s+(?:public\.)?([a-z_0-9]+)[^;]*;/gi)) out.push(m[0].replace(/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "CREATE UNIQUE INDEX IF NOT EXISTS "));
    for (const m of src.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?([a-z_0-9]+)\s+ADD\s+CONSTRAINT\s+([a-z_0-9]+)\s+UNIQUE\s*\(([^)]+)\)/gi)) out.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${m[2]} ON public.${m[1]} (${m[3]});`);
    for (const t of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, table, body] = t as unknown as [string, string, string];
      let i = 0;
      for (const u of body.matchAll(/(?:^|,)\s*(?:CONSTRAINT\s+[a-z_0-9]+\s+)?UNIQUE\s*\(([^)]+)\)/gim)) out.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_inline_u${i++} ON public.${table} (${u[1]});`);
      for (const c of body.matchAll(/(?:^|,|\()\s*([a-z_0-9]+)\s+[a-z ]+?[^,]*?\bUNIQUE\b(?!\s*\()/gim)) out.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_${c[1]}_inline_key ON public.${table} (${c[1]});`);
    }
  }
  return out;
}

/** Column DEFAULTs exactly as the migration chain declares them (CREATE TABLE column lines, ADD COLUMN … DEFAULT,
 *  ALTER COLUMN … SET DEFAULT; later statements win). Applied over the neutral generated defaults; a default that names
 *  something the generated schema lacks is skipped. */
export function columnDefaultsSql(): string[] {
  const out = new Map<string, string>();
  const splitTop = (s: string) => { const r: string[] = []; let d = 0, cur = "", q = false; for (const ch of s) { if (ch === "'") q = !q; if (!q && (ch === "(" || ch === "[")) d++; if (!q && (ch === ")" || ch === "]")) d--; if (!q && ch === "," && d === 0) { r.push(cur); cur = ""; continue; } cur += ch; } if (cur.trim()) r.push(cur); return r; };
  const defaultOf = (def: string) => {
    const m = /\bdefault\s+([\s\S]+)$/i.exec(def);
    if (!m) return null;
    let expr = m[1]!.trim(), d = 0, q = false, end = expr.length;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]!;
      if (ch === "'") q = !q;
      if (q) continue;
      if (ch === "(") d++; if (ch === ")") d--;
      if (d === 0 && /\s/.test(ch) && /^\s+(not\s+null|null|check|references|unique|primary|constraint|generated|collate)\b/i.test(expr.slice(i))) { end = i; break; }
    }
    expr = expr.slice(0, end).trim();
    return expr || null;
  };
  const dirs = [new URL("../../drizzle/migrations/", import.meta.url), new URL("../../docs/pending-migrations/", import.meta.url)];
  for (const dir of dirs) for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && !/rollback/i.test(x)).sort()) {
    const src = readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, "");
    for (const t of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
      for (const colDef of splitTop(t[2]!)) {
        const m = /^\s*"?([a-z_0-9]+)"?\s+[a-z]/i.exec(colDef);
        if (!m || /^(constraint|primary|unique|check|foreign|exclude)$/i.test(m[1]!)) continue;
        const d = defaultOf(colDef); if (d) out.set(`${t[1]}.${m[1]}`, d);
      }
    }
    for (const a of src.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+([\s\S]*?);/gi)) {
      for (const part of splitTop(a[2]!)) {
        const add = /^\s*ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?\s+([\s\S]+)$/i.exec(part);
        if (add) { const d = defaultOf(add[2]!); if (d) out.set(`${a[1]}.${add[1]}`, d); continue; }
        const set = /^\s*ALTER\s+COLUMN\s+"?([a-z_0-9]+)"?\s+SET\s+DEFAULT\s+([\s\S]+)$/i.exec(part);
        if (set) out.set(`${a[1]}.${set[1]}`, set[2]!.trim());
      }
    }
  }
  return [...out].map(([k, d]) => { const [t, c] = k.split("."); return `ALTER TABLE public."${t}" ALTER COLUMN "${c}" SET DEFAULT ${d};`; });
}

/** The latest CREATE [OR REPLACE] VIEW statement per view in the migration chain, then the pending migrations
 *  (numbered files first, then named ones — the same order the SQL functions use). */
export function viewSql(): Map<string, string> {
  const out = new Map<string, string>();
  const applied = new URL("../../drizzle/migrations/", import.meta.url), pending = new URL("../../docs/pending-migrations/", import.meta.url);
  const pend = readdirSync(pending).filter((x) => x.endsWith(".sql") && !/rollback|verify|abort|revert/i.test(x));
  const files: [URL, string][] = [
    ...readdirSync(applied).filter((x) => x.endsWith(".sql")).sort().map((f) => [applied, f] as [URL, string]),
    ...pend.filter((f) => /^\d/.test(f)).sort().map((f) => [pending, f] as [URL, string]),
    ...pend.filter((f) => !/^\d/.test(f)).sort().map((f) => [pending, f] as [URL, string]),
  ];
  for (const [dir, f] of files) {
    const src = readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, "");
    for (const m of src.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?([a-z_0-9]+)"?(?:\s+WITH\s*\([^)]*\))?\s+AS\s+[\s\S]*?;/gi)) out.set(m[1]!, m[0]);
  }
  return out;
}

export type JourneyDb = Awaited<ReturnType<typeof journeyDb>>;
/** A fresh PGlite with every portal table, plus the shim the server modules see as `supabaseAdmin`. */
export async function journeyDb(opts: { extraSql?: string; relOverrides?: Rels } = {}) {
  // Values come back the way PostgREST returns them: numeric / bigint as numbers, dates as "YYYY-MM-DD".
  const db = new PGlite({ parsers: { 1700: (v: string) => Number(v), 20: (v: string) => Number(v), 1082: (v: string) => v } });
  const { sql, rels } = journeySchemaSql();
  await db.exec(sql);
  for (const [t, cols] of Object.entries(COLUMNS_MISSING_FROM_TYPES)) for (const c of cols) await db.exec(`ALTER TABLE public."${t}" ADD COLUMN IF NOT EXISTS ${c};`);
  for (const d of columnDefaultsSql()) { try { await db.exec(d); } catch { /* names a column/type the generated schema lacks */ } }
  for (const u of uniqueConstraintSql()) { try { await db.exec(u); } catch { /* names a column/table the generated schema lacks */ } }
  // Views are real views where the migration chain defines them (e.g. job_piesa_deadlines, which the install gates read);
  // a view the generated schema cannot support stays an empty table. Repeat: views can read other views.
  const views = viewSql(), made: string[] = [];
  for (let pass = 0; pass < 3; pass++) for (const [name, vsql] of views) {
    if (made.includes(name)) continue;
    try { await db.transaction(async (tx) => { await tx.exec(`DROP TABLE IF EXISTS public."${name}"; DROP VIEW IF EXISTS public."${name}"; ${vsql}`); }); made.push(name); } catch { /* keeps the placeholder table */ }
  }
  if (opts.extraSql) await db.exec(opts.extraSql);
  for (const [t, r] of Object.entries(opts.relOverrides ?? {})) rels[t] = { ...(rels[t] ?? {}), ...r };
  const shim = embedShim(db, rels);
  const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await db.query<T>(s, p)).rows;
  return { db, shim, rels, q };
}
