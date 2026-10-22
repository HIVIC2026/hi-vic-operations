// Test-only: execute the actual server/core source against a throw-away PostgreSQL engine.
// The loader substitutes only Supabase and fetch boundaries; it does not reimplement business rules.
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { readFileSync } from "node:fs";

export const TEST_MAILBOX = "shared@example.test";
export const TEST_JOB = "11111111-1111-4111-8111-111111111111";
export const TEST_ACTOR = "22222222-2222-4222-8222-222222222222";
const root = new URL("../../", import.meta.url);
export const migration = () => readFileSync(new URL("docs/pending-migrations/0212_outlook_recovery.sql", root), "utf8")
  + "\n" + readFileSync(new URL("docs/pending-migrations/0221_outlook_history.sql", root), "utf8");
export const rollback = () => readFileSync(new URL("docs/pending-migrations/0221_outlook_history.rollback.sql", root), "utf8")
  + "\n" + readFileSync(new URL("docs/pending-migrations/0212_outlook_recovery.rollback.sql", root), "utf8");

export type Operation = { table: string; mode: string; head: boolean; fields: string; filters: { field: string; op: string; value: unknown }[] };
type Result = { data: any; error: { message: string; code?: string } | null; count?: number | null };

export async function outlookHarness() {
  const db = new PGlite();
  // Existing-table fixture includes the constraints, enum assignment, and columns used by the new migration.
  // The pending migration itself is loaded verbatim and executed twice.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TYPE job_stage AS ENUM ('new_enquiry','eligibility_review','preliminary_estimate_ready',
      'ready_check_awaiting_acceptance','installation_booked','cancelled','complete');
    CREATE TABLE owners(id uuid PRIMARY KEY, email text);
    CREATE TABLE properties(id uuid PRIMARY KEY, address_line text, postcode text);
    CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_number text,owner_id uuid REFERENCES owners(id),
      property_id uuid REFERENCES properties(id),stage job_stage NOT NULL DEFAULT 'new_enquiry',prior_stage job_stage,
      source text NOT NULL DEFAULT 'website',deleted_at timestamptz,cancelled_reason text,next_action text,last_activity_at timestamptz);
    CREATE TABLE job_communications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
      direction text NOT NULL CHECK(direction IN('inbound','outbound','internal')),channel text NOT NULL,
      sender_user_id uuid,sender_text text,recipients jsonb NOT NULL DEFAULT '[]',subject text,body text NOT NULL DEFAULT '',
      provider text NOT NULL DEFAULT 'manual',provider_message_id text,provider_thread_id text,sent_at timestamptz,received_at timestamptz,
      delivery_status text NOT NULL DEFAULT 'recorded',visibility text NOT NULL DEFAULT 'internal',attachment_refs jsonb NOT NULL DEFAULT '[]',
      source_event text,source_reference text,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE workflow_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES jobs(id),actor_id uuid,
      event_type text NOT NULL,summary text NOT NULL,details jsonb,from_stage job_stage,to_stage job_stage,internal boolean NOT NULL DEFAULT false);
    CREATE TABLE admin_config_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,event_type text NOT NULL,summary text NOT NULL,details jsonb);
  `);
  await db.exec(readFileSync(new URL("docs/pending-migrations/0207_outlook_correspondence.sql", root), "utf8"));
  await db.exec(migration()); await db.exec(migration());
  // PostgREST returns timestamp strings. PGlite's JS Date parser has millisecond precision.
  await db.exec(`ALTER TABLE outlook_sync_state ALTER COLUMN updated_at TYPE timestamptz(3);
    INSERT INTO owners VALUES ('33333333-3333-4333-8333-333333333333','owner@example.test');
    INSERT INTO properties VALUES ('44444444-4444-4444-8444-444444444444','1 Fixture Road','3000');
    INSERT INTO jobs(id,job_number,owner_id,property_id) VALUES ('${TEST_JOB}','HV-1001','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');`);
  const operations: Operation[] = [];
  const requests: { url: string; options: RequestInit }[] = [];
  const control = {
    fault: null as ((op: Operation) => Result | null) | null,
    fetch: async (_url: string, _options: RequestInit): Promise<Response> => new Response(JSON.stringify({ value: [] })),
  };
  const quote = (field: string) => field === "message->>direction" ? "message->>'direction'" : `"${field.replaceAll('"', '""')}"`;
  const serialise = (value: unknown): any => JSON.parse(JSON.stringify(value));
  class Query {
    mode = "read"; fields = "*"; head = false; exact = false; filters: Operation["filters"] = [];
    values: Record<string, unknown> = {}; ordering: { field: string; ascending: boolean }[] = [];
    maximum: number | null = null; offset = 0; shape: "many" | "single" | "maybe" = "many";
    readonly table: string;
    constructor(table: string) { this.table = table; }
    select(fields = "*", opts: { count?: string; head?: boolean } = {}) { this.fields = fields; this.head = !!opts.head; this.exact = opts.count === "exact"; return this; }
    update(values: Record<string, unknown>) { this.mode = "update"; this.values = values; return this; }
    insert(values: Record<string, unknown>) { this.mode = "insert"; this.values = values; return this; }
    filter(field: string, op: string, value: unknown) { this.filters.push({ field, op, value }); return this; }
    eq(f: string, v: unknown) { return this.filter(f, "=", v); }
    neq(f: string, v: unknown) { return this.filter(f, "<>", v); }
    is(f: string, v: unknown) { return this.filter(f, "IS", v); }
    in(f: string, v: unknown[]) { return this.filter(f, "IN", v); }
    gt(f: string, v: unknown) { return this.filter(f, ">", v); }
    gte(f: string, v: unknown) { return this.filter(f, ">=", v); }
    lte(f: string, v: unknown) { return this.filter(f, "<=", v); }
    or(expression: string) { return this.filter("email", "EMAIL_ANY", expression.split(",").map(x => x.replace(/^email\.ilike\./, ""))); }
    order(field: string, opts: { ascending?: boolean } = {}) { this.ordering.push({ field, ascending: opts.ascending !== false }); return this; }
    limit(n: number) { this.maximum = n; return this; }
    range(start: number, end: number) { this.offset = start; this.maximum = end - start + 1; return this; }
    single() { this.shape = "single"; return this; }
    maybeSingle() { this.shape = "maybe"; return this; }
    then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) { return this.run().then(resolve, reject); }
    async run(): Promise<Result> {
      const operation = { table: this.table, mode: this.mode, head: this.head, fields: this.fields, filters: this.filters };
      operations.push(operation);
      const fault = control.fault?.(operation); if (fault) return fault;
      const params: unknown[] = [];
      const param = (value: unknown) => { params.push(typeof value === "object" && value !== null && !Array.isArray(value) ? JSON.stringify(value) : value); return `$${params.length}`; };
      const where = this.filters.map(({ field, op, value }) => {
        if (op === "IS") return `${quote(field)} IS NULL`;
        if (op === "IN" || op === "EMAIL_ANY") return `${op === "EMAIL_ANY" ? `lower(${quote(field)})` : quote(field)} IN (${(value as unknown[]).map(param).join(",")})`;
        return `${quote(field)} ${op} ${param(value)}`;
      }).join(" AND ");
      const suffix = where ? ` WHERE ${where}` : "";
      try {
        let sql: string;
        const fields = this.fields === "*" || this.fields.includes("owners!") ? "*" : this.fields.split(",").map(x => quote(x.trim())).join(",");
        if (this.mode === "update") sql = `UPDATE ${quote(this.table)} SET ${Object.entries(this.values).map(([k, v]) => `${quote(k)}=${param(v)}`).join(",")}${suffix} RETURNING ${fields}`;
        else if (this.mode === "insert") sql = `INSERT INTO ${quote(this.table)} (${Object.keys(this.values).map(quote).join(",")}) VALUES (${Object.values(this.values).map(param).join(",")}) RETURNING ${fields}`;
        else {
          const from = this.fields.includes("owners!")
            ? `(SELECT j.*,json_build_object('email',o.email) AS owners,json_build_object('address_line',p.address_line,'postcode',p.postcode) AS properties FROM jobs j JOIN owners o ON o.id=j.owner_id LEFT JOIN properties p ON p.id=j.property_id) fixture`
            : quote(this.table);
          sql = `SELECT ${this.head ? "count(*)::int AS count" : fields} FROM ${from}${suffix}`;
          if (!this.head) {
            if (this.ordering.length) sql += ` ORDER BY ${this.ordering.map(o => `${quote(o.field)} ${o.ascending ? "ASC" : "DESC"}`).join(",")}`;
            if (this.maximum !== null) sql += ` LIMIT ${this.maximum} OFFSET ${this.offset}`;
          }
        }
        const rows = serialise((await db.query(sql, params)).rows);
        if (this.head) return { data: null, error: null, count: rows[0].count };
        if (this.shape === "single" && rows.length !== 1) return { data: null, error: { message: "Expected exactly one row", code: "PGRST116" } };
        return { data: this.shape === "many" ? rows : rows[0] ?? null, error: null };
      } catch (error: any) { return { data: null, error: { message: error.message, code: error.code } }; }
    }
  }
  // Private attachment storage mock: deterministic paths, real bytes, no overwrite of an existing object.
  const files = new Map<string, Uint8Array>();
  const storage = {
    from: (bucket: string) => ({
      async upload(path: string, body: unknown) {
        if (files.has(path)) return { data: null, error: { message: `The resource already exists (${bucket})` } };
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
        files.set(path, bytes);
        return { data: { path }, error: null };
      },
      async download(path: string) {
        const bytes = files.get(path);
        return bytes ? { data: new Blob([bytes as unknown as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
      },
    }),
  };
  const admin = {
    from: (table: string) => new Query(table),
    storage,
    async rpc(name: string, args: Record<string, unknown>): Promise<Result> {
      operations.push({ table: name, mode: "rpc", head: false, fields: "*", filters: [] });
      const values = Object.values(args).map(v => typeof v === "object" ? JSON.stringify(v) : v);
      try { const row = (await db.query(`SELECT ${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS data`, values)).rows[0] as { data: unknown }; return { data: serialise(row.data), error: null }; }
      catch (error: any) { return { data: null, error: { message: error.message, code: error.code } }; }
    },
  };
  const modules = new Map<string, any>();
  const load = (name: string): any => {
    if (modules.has(name)) return modules.get(name);
    const source = readFileSync(new URL(`src/lib/${name}.ts`, root), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }; modules.set(name, module.exports);
    const require = (path: string) => path === "@/integrations/supabase/client.server" ? { supabaseAdmin: admin }
      : path.startsWith("./outlook-") ? load(path.slice(2)) : (() => { throw new Error(`Unexpected dependency ${path}`); })();
    new Function("require", "module", "exports", "process", "fetch", output)(require, module, module.exports,
      { env: { LOVABLE_API_KEY: "fixture-gateway-key", MICROSOFT_OUTLOOK_API_KEY: "fixture-connection-key" } },
      async (url: string, options: RequestInit) => { requests.push({ url, options }); return control.fetch(url, options); });
    return module.exports;
  };
  const server = load("outlook-sync.server");
  const connection = load("outlook-connection.core");
  const counts = () => ({ fetched: 0, stored: 0, duplicate: 0, portalDuplicate: 0, notHomeowner: 0, unmatched: 0, closed: 0, flagged: 0, files: 0, filesSkipped: 0, errors: 0 });
  const state = async () => (await db.query(`SELECT * FROM outlook_sync_state WHERE id=1`)).rows[0] as any;
  return { db, server, connection, counts, state, control, operations, requests, files };
}

export const graphMessage = (id: string, body = "Hello", extras: Record<string, unknown> = {}) => ({
  id, subject: "HV-1001", body: { contentType: "text", content: body },
  from: { emailAddress: { address: "owner@example.test" } }, toRecipients: [{ emailAddress: { address: TEST_MAILBOX } }],
  receivedDateTime: "2026-10-20T08:00:00Z", sentDateTime: "2026-10-20T08:00:00Z", hasAttachments: false, ...extras,
});
export const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
export const bytesResponse = (bytes: Uint8Array, contentType = "application/octet-stream") =>
  new Response(bytes as unknown as BodyInit, { status: 200, headers: { "Content-Type": contentType } });
