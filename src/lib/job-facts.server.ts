// Speed (portal speed step 2 part A, Task 11): the installer job page reads this job's rows ONCE and its sections' own
// queries are answered from them. Why: the portal's server (Cloudflare Workers) lets only 6 outgoing requests wait at a
// time, and the page made ~150 reads at ~300 ms each.
// How it stays safe:
// - The facts are read only after `requireTradeJob` passed for this user and job (`loadJobFacts` refuses anything else),
//   with the same admin client every section already used: the job's rows by job id, the caller's OWN verified business
//   (row, partner workers, members) by its id, and the settings row — nothing from another job or business. At most
//   three reads, each on first use.
// - Sections keep their own queries and logic. Inside the bundle, `jobDb()` gives them a client that answers a query from
//   the facts when it can be sure of the database's answer (`answerFromFacts`), and otherwise sends that same query to
//   the database. Identical queries in one bundle are asked once. Outside the bundle `jobDb()` is the admin client.
// - Writes go straight to the database and stop all answering from memory for the rest of that bundle.
// Server-side only; nothing here is sent to the browser.
import { AsyncLocalStorage } from "node:async_hooks";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { answerFromFacts, BUSINESS_FACT_TABLES, BUSINESS_FACTS_SELECT, businessFactsFrom, factsCanTry, JOB_FACT_TABLES, JOB_FACTS_SELECT, jobFactsFrom, settingsFactsFrom, type Facts, type FactTable, type QueryOp } from "./job-facts.core";
import { FACT_COLUMNS } from "./job-facts.columns";
import type { TradeJobAccess } from "./trade-view.server";

export type JobFacts = Facts;
type Admin = typeof supabaseAdmin;
type Row = Record<string, unknown>;

/** Every row of this job the installer job page reads, in ONE request — after the access check, for that user and job only. */
export async function loadJobFacts(jobId: string, access: TradeJobAccess): Promise<Facts | null> {
  if (access.checkedFor.jobId !== jobId) throw new Error("Job facts are read only for the job that passed the access check.");
  const { data, error } = await supabaseAdmin.from("jobs").select(JOB_FACTS_SELECT).eq("id", jobId).maybeSingle();
  // On a failed read the sections read for themselves, exactly as before.
  if (error) console.error("job facts read failed; sections read for themselves", error.message);
  return error || !data ? null : jobFactsFrom(jobId, data as unknown as Row, FACT_COLUMNS);
}

/** The caller's own business row, its partner workers and members, in ONE request — only the business the access check verified. */
export async function loadBusinessFacts(businessId: string, access: TradeJobAccess): Promise<Facts | null> {
  if (access.biz.id !== businessId) throw new Error("Business facts are read only for the caller's verified business.");
  const { data, error } = await supabaseAdmin.from("businesses").select(BUSINESS_FACTS_SELECT).eq("id", businessId).maybeSingle();
  if (error) console.error("business facts read failed; sections read for themselves", error.message);
  return error || !data ? null : businessFactsFrom(businessId, data as unknown as Row, FACT_COLUMNS);
}

/** The portal settings row (`workflow_settings` id 1), once. */
export async function loadSettingsFacts(): Promise<Facts | null> {
  const { data, error } = await supabaseAdmin.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  if (error) console.error("settings facts read failed; sections read for themselves", error.message);
  return error || !data ? null : settingsFactsFrom(data as unknown as Row);
}

/** A set of fact tables (each with its scope) and how to read them; read at most once, on first use. */
export type FactSource = { readonly tables: Readonly<Record<string, FactTable["scope"]>>; readonly load: () => Promise<Facts | null> };

const READS = new Set(["select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "not", "or", "filter", "match", "order", "limit", "range", "maybeSingle", "single", "returns"]);
const WRITES = new Set(["insert", "update", "upsert", "delete"]);
const READ_RPCS = new Set(["has_role", "is_admin", "has_contact_release", "my_job_role", "can_access_job"]);

/**
 * A client for one bundle: `.from(table)` records the query; when awaited it is answered from the job's facts if
 * `answerFromFacts` is sure, else sent to the database as written. Identical reads are asked once (each caller gets its own copy of the rows).
 */
export function jobFactsClient(sources: readonly FactSource[], base: Admin = supabaseAdmin): Admin {
  const loaded = new Map<FactSource, Promise<Facts | null>>();
  const factsOf = (s: FactSource) => { let p = loaded.get(s); if (!p) { p = s.load().catch(() => null); loaded.set(s, p); } return p; };
  const asked = new Map<string, Promise<unknown>>();
  let wrote = false;
  const copy = (res: unknown) => {
    if (!res || typeof res !== "object" || !("data" in res)) return res;
    const r = res as { data: unknown };
    return { ...r, data: r.data === null || typeof r.data !== "object" ? r.data : JSON.parse(JSON.stringify(r.data)) };
  };
  const from = (table: string) => {
    const ops: QueryOp[] = [];
    const send = () => { let q = base.from(table as never) as unknown as Record<string, (...a: unknown[]) => unknown>; for (const o of ops) q = q[o.m]!(...o.a) as typeof q; return q as unknown as PromiseLike<unknown>; };
    const run = (): Promise<unknown> => {
      if (ops.some((o) => WRITES.has(o.m))) { wrote = true; return Promise.resolve(send()); }
      if (wrote || !ops.every((o) => READS.has(o.m))) return Promise.resolve(send());
      let key: string;
      try { key = `${table}|${JSON.stringify(ops)}`; } catch { return Promise.resolve(send()); }
      let p = asked.get(key);
      if (!p) {
        const source = sources.find((s) => table in s.tables);
        p = source && factsCanTry(table, source.tables[table]!, ops) ? factsOf(source).then((f) => (f && !wrote ? answerFromFacts(f, table, ops) : null) ?? send(), () => send()) : Promise.resolve(send());
        asked.set(key, p);
      }
      return p.then(copy);
    };
    const q: unknown = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") return (ok?: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad);
        // A query builder is only `then`-able (no catch/finally), like postgrest-js's.
        if (typeof prop !== "string" || prop === "catch" || prop === "finally") return undefined;
        return (...a: unknown[]) => { ops.push({ m: prop, a }); return q; };
      },
    });
    return q;
  };
  // A database function that isn't a known read may write: from then on every query goes to the database.
  const rpc = (...a: unknown[]) => { if (!READ_RPCS.has(String(a[0]))) wrote = true; return (base as unknown as { rpc: (...x: unknown[]) => unknown }).rpc(...a); };
  return new Proxy(base, { get: (t, prop, r) => (prop === "from" ? from : prop === "rpc" ? rpc : Reflect.get(t, prop, r)) }) as Admin;
}

type Scope = { readonly jobId: string; readonly db: Admin };
const scope = new AsyncLocalStorage<Scope>();

/**
 * Runs `fn` (the bundle's sections, started after the access check) with `jobDb()` answering from this job's facts. The
 * facts are read on the first query that could use them.
 */
export function withJobFacts<T>(jobId: string, access: TradeJobAccess, fn: () => T): T {
  const job: FactSource = { tables: Object.fromEntries([["jobs", { col: "id", value: jobId }], ...JOB_FACT_TABLES.map((t) => [t, { col: "job_id", value: jobId }])]), load: () => loadJobFacts(jobId, access) };
  const bizId = access.biz.id;
  const business: FactSource = { tables: Object.fromEntries([["businesses", { col: "id", value: bizId }], ...BUSINESS_FACT_TABLES.map((t) => [t, { col: "business_id", value: bizId }])]), load: () => loadBusinessFacts(bizId, access) };
  const settings: FactSource = { tables: { workflow_settings: { col: "id", value: "1" } }, load: loadSettingsFacts };
  return scope.run({ jobId, db: jobFactsClient([job, business, settings]) }, fn);
}

/** The admin client — inside the job page bundle, the one that answers from the job's facts (see above). */
export function jobDb(): Admin {
  return scope.getStore()?.db ?? supabaseAdmin;
}

/**
 * Stands in for `supabaseAdmin` in the modules the job page bundle runs: every use goes to `jobDb()` at that moment — the
 * admin client itself, except inside the bundle (see `withJobFacts`).
 */
export const jobAdmin: Admin = new Proxy({} as Admin, { get: (_, prop) => Reflect.get(jobDb(), prop) });
