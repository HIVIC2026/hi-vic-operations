// Executes the actual source modules with test-only I/O boundaries. Never contacts Mitti or a database.
import { readFileSync } from "node:fs";
import ts from "typescript";

type Any = any;
export type DbOperation = { table: string; mode: "read" | "update" | "insert"; fields: string; values: Any; filters: [string, unknown][]; count: boolean };
export type DbResult = { data: Any; error: { message: string } | null; count?: number | null };
export type ApiOperation = { method: string; path: string; body?: Any };
const root = new URL("../../src/lib/", import.meta.url);

export function createMittiBoundaryHarness(options: {
  database?: (op: DbOperation) => DbResult | Promise<DbResult>;
  provider?: (op: ApiOperation) => unknown | Promise<unknown>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  dependencies?: Record<string, Any>;
  token?: string;
} = {}) {
  const dbCalls: DbOperation[] = [];
  const apiCalls: ApiOperation[] = [];
  const eventCalls: Any[][] = [];
  const authCalls: unknown[] = [];
  const logs: unknown[][] = [];
  const httpCalls: { url: string; init: RequestInit }[] = [];
  class Query {
    operation: DbOperation;
    constructor(table: string) { this.operation = { table, mode: "read", fields: "*", values: null, filters: [], count: false }; }
    select(fields = "*", opts?: { count?: string }) { this.operation.fields = fields; this.operation.count = opts?.count === "exact"; return this; }
    eq(field: string, value: unknown) { this.operation.filters.push([field, value]); return this; }
    order() { return this; }
    limit() { return this; }
    single() { return this; }
    maybeSingle() { return this; }
    update(values: Any) { this.operation.mode = "update"; this.operation.values = values; return this; }
    insert(values: Any) { this.operation.mode = "insert"; this.operation.values = values; return this; }
    then(resolve: (result: DbResult) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        dbCalls.push(this.operation);
        if (!options.database) throw new Error(`Unexpected database request: ${this.operation.table}`);
        return options.database(this.operation);
      }).then(resolve, reject);
    }
  }
  const dependencies: Record<string, Any> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: { from: (table: string) => new Query(table) } },
    "./workflow.server": {
      WorkflowError: class WorkflowError extends Error {},
      requireAdmin: async (client: Any) => { authCalls.push(client); if (client?.testRole !== "admin") throw new Error("Admin access required"); },
      logEvent: async (...args: Any[]) => { eventCalls.push(args); },
    },
    // Framework transport and schema parsing are outside this harness. The actual handler body runs.
    "@tanstack/react-start": { createServerFn: () => {
      const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn: Any) => fn };
      return chain;
    } },
    zod: { z: {} },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "./network-timeout.core": { MITTI_FETCH_TIMEOUT_MS: 1000, timeoutSignal: () => new AbortController().signal },
    "./scope.core": {}, "./requirements.server": {}, "./mitti-forms.core": {},
    "./official-forms.core": {}, "./official-short.core": {}, "./official-expand.core": {},
    "./address": {}, "./eligibility.server": {}, "./piesa-date.core": {},
    "./official-forms.server": {}, "./installer-quote.server": {}, "./pilot.server": {},
    ...options.dependencies,
  };
  const cache = new Map<string, Any>();
  const actual = new Set(["mitti.core", "mitti-identity.core", "mitti-form-health.core", "mitti-form-health.server", "mitti.server", "mitti-forms.functions"]);
  const load = (name: string): Any => {
    if (cache.has(name)) return cache.get(name);
    if (!actual.has(name)) throw new Error(`Unexpected source module ${name}`);
    const source = readFileSync(new URL(`${name}.ts`, root), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as Any }; cache.set(name, module.exports);
    const require = (id: string): Any => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id.startsWith("./") && actual.has(id.slice(2))) return load(id.slice(2));
      throw new Error(`Unexpected dependency ${id}`);
    };
    new Function("require", "module", "exports", "process", "fetch", "console", output)(
      require, module, module.exports, { env: { MITTI_API_TOKEN: options.token } },
      async (url: string, init: RequestInit) => {
        httpCalls.push({ url, init });
        if (!options.fetch) throw new Error("No real network in Mitti tests");
        return options.fetch(url, init);
      }, { error: (...args: unknown[]) => logs.push(args) },
    );
    return module.exports;
  };
  const call = async (method: string, path: string, body?: Any): Promise<Any> => {
    const op = { method, path, body }; apiCalls.push(op);
    if (!options.provider) throw new Error(`Unexpected Mitti request: ${method} ${path}`);
    return options.provider(op);
  };
  return { load, call, dbCalls, apiCalls, eventCalls, authCalls, logs, httpCalls };
}

/** Mitti's search endpoint uses POST for a read; mutations are audit create/update/share/owner only. */
export const providerWrites = (calls: ApiOperation[]) => calls.filter(c => c.method !== "GET" && c.path !== "/users/search");
