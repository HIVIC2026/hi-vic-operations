// Speed (portal speed step 2 part A, Task 11): the installer job page reads this job's rows ONCE and its sections' own
// queries are answered from them. Why: the portal's server (Cloudflare Workers) lets only 6 outgoing requests wait at a
// time, and the page made ~150 reads at ~300 ms each.
// How it stays safe:
// - The facts are read only after `requireTradeJob` passed for this user and job (`loadJobFacts` refuses anything else),
//   with the same admin client every section already used, by job id only — nothing from another job or business.
// - Sections keep their own queries and logic. Inside the bundle, `jobDb()` gives them a client that answers a query from
//   the facts when it can be sure of the database's answer (`answerFromFacts`), and otherwise sends that same query to
//   the database. Identical queries in one bundle are asked once. Outside the bundle `jobDb()` is the admin client.
// - Writes go straight to the database and stop all answering from memory for the rest of that bundle.
// Server-side only; nothing here is sent to the browser.
import { AsyncLocalStorage } from "node:async_hooks";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { answerFromFacts, factsCanTry, JOB_FACT_TABLES, JOB_FACTS_SELECT, jobFactsFrom, type JobFacts, type QueryOp } from "./job-facts.core";
import type { TradeJobAccess } from "./trade-view.server";

export type { JobFacts } from "./job-facts.core";
type Admin = typeof supabaseAdmin;

/** Every row of this job the installer job page reads, in ONE request — after the access check, for that user and job only. */
export async function loadJobFacts(jobId: string, access: TradeJobAccess): Promise<JobFacts | null> {
  if (access.checkedFor.jobId !== jobId) throw new Error("Job facts are read only for the job that passed the access check.");
  const { data, error } = await supabaseAdmin.from("jobs").select(JOB_FACTS_SELECT).eq("id", jobId).maybeSingle();
  if (error || !data) {
    // The sections then read for themselves, exactly as before.
    if (error) console.error("job facts read failed; sections read for themselves", error.message);
    return null;
  }
  return jobFactsFrom(jobId, data as unknown as Record<string, unknown>);
}

const READS = new Set(["select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "not", "or", "filter", "match", "order", "limit", "range", "maybeSingle", "single", "returns"]);
const FACT_TABLES = new Set<string>(["jobs", ...JOB_FACT_TABLES]);
const WRITES = new Set(["insert", "update", "upsert", "delete"]);

/**
 * A client for one bundle: `.from(table)` records the query; when awaited it is answered from the job's facts if
 * `answerFromFacts` is sure, else sent to the database as written. Identical reads are asked once (each caller gets its own copy of the rows).
 */
export function jobFactsClient(jobId: string, facts: () => Promise<JobFacts | null>, base: Admin = supabaseAdmin): Admin {
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
        p = FACT_TABLES.has(table) && factsCanTry(jobId, table, ops) ? facts().then((f) => (f && !wrote ? answerFromFacts(f, table, ops) : null) ?? send(), () => send()) : Promise.resolve(send());
        asked.set(key, p);
      }
      return p.then(copy);
    };
    const q: unknown = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") return (ok?: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad);
        if (typeof prop !== "string") return undefined;
        return (...a: unknown[]) => { ops.push({ m: prop, a }); return q; };
      },
    });
    return q;
  };
  return new Proxy(base, { get: (t, prop, r) => (prop === "from" ? from : Reflect.get(t, prop, r)) }) as Admin;
}

type Scope = { readonly jobId: string; readonly db: Admin };
const scope = new AsyncLocalStorage<Scope>();

/**
 * Runs `fn` (the bundle's sections, started after the access check) with `jobDb()` answering from this job's facts. The
 * facts are read on the first query that could use them.
 */
export function withJobFacts<T>(jobId: string, access: TradeJobAccess, fn: () => T): T {
  let facts: Promise<JobFacts | null> | undefined;
  const db = jobFactsClient(jobId, () => (facts ??= loadJobFacts(jobId, access).catch(() => null)));
  return scope.run({ jobId, db }, fn);
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
