// FIX #2 (PIESA future-date validation) — RUNTIME evidence through the REAL saveAssessment server handler.
//
// What is REAL here:
//   * the actual `saveAssessment` handler in src/lib/portal.functions.ts (inputValidator + handler body),
//   * a real PostgreSQL engine (PGlite, in-memory) holding the fixture, read before/after with real SQL,
//   * the real authorization SQL from the migration chain (0000 my_job_role / has_role, 0023 is_business_member,
//     0115 job_assignment_role, 0147 can_access_job), evaluated as role `authenticated` with auth.uid() = caller,
//   * the real piesa-date.core rule reached through that handler (not called directly).
// What is STUBBED (the transport, not the logic):
//   * the TanStack wrapper (createServerFn) — the handler is invoked exactly as the framework would, and
//   * the auth middleware — the handler receives the caller's RLS-scoped client, as it does in production.
// ISOLATION: in-memory database, no network at all. A fetch guard records every outbound call and must be
// empty at the end, which proves Production was never contacted. Synthetic rows only.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { melbourneToday } from "@/lib/melbourne-time.core";

// ---- outbound network guard (installed before anything is imported) ----
const net: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown, init?: unknown) => {
  net.push(String((input as Request)?.url ?? input));
  return realFetch(input as never, init as never);
}) as typeof globalThis.fetch;

type Ctx = { supabase: unknown; userId: string };
type Call = (a: { data: unknown; context: Ctx }) => Promise<unknown>;
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (f: typeof validate) => { validate = f; return b; },
      handler: (h: (a: { data: unknown; context: Ctx }) => Promise<unknown>): Call => (a) => h({ data: validate(a.data), context: a.context }),
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const M = (f: string) => readFileSync(`drizzle/migrations/${f}`, "utf8");
/** The exact `create or replace function public.<name>` statement from a migration file (source-faithful). */
function fn(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  if (start < 0) throw new Error(`${name} not found`);
  const re = /\$[A-Za-z_]*\$/g;
  re.lastIndex = start;
  const open = re.exec(sql);
  if (!open) throw new Error(`${name}: no body`);
  const close = sql.indexOf(open[0], open.index + open[0].length);
  return sql.slice(start, sql.indexOf(";", close) + 1);
}
const CORE = M("0000_hivic_core_schema.sql"), P23 = M("0023_reinsulate_pilot_partner_network.sql"), P115 = M("0115_trade_job_access.sql"), P147 = M("0147_job_soft_delete.sql");

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const U = { sparky: id(0x901), office: id(0x902), stranger: id(0x903), ownerA: id(0x904) };
const BIZ = { recA: id(0xb11) };
const OWN = { a: id(0xc11) };
// Two disposable TEST fixtures: one WITH an existing assessment row, one WITHOUT (proves no INSERT happens).
const JOB = { withDraft: id(0xd11), noDraft: id(0xd12) };

const db = new PGlite();
await db.exec(`
  CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create type public.app_role as enum ('admin','electrician','installer','owner','property_manager');
  create type public.assignment_role as enum ('electrician','installer','property_manager');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role, unique (user_id, role));
  CREATE TABLE public.owners (id uuid primary key, user_id uuid);
  CREATE TABLE public.jobs (id uuid primary key, owner_id uuid, deleted_at timestamptz, stage text, source text, qa_archived_at timestamptz, last_activity_at timestamptz);
  CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, business_id uuid, role public.assignment_role, active boolean default true);
  CREATE TABLE public.businesses (id uuid primary key, onboarding_status text);
  CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean default true, added_by uuid, unique (business_id, user_id));
  CREATE TABLE public.profiles (id uuid primary key, business_id uuid, email text, full_name text, licence_number text);
  CREATE TABLE public.partner_workers (id uuid primary key default gen_random_uuid(), profile_id uuid, business_id uuid, trade_role public.assignment_role, approval_status text, removed_at timestamptz, licence_expires_on date,
    email text, full_legal_name text, licence_number text, account_status text, linked_by uuid, linked_at timestamptz);
  CREATE TABLE public.worker_job_links (job_id uuid, worker_id uuid, business_id uuid, revoked_at timestamptz, expires_at timestamptz);
  CREATE TABLE public.assessments (id uuid primary key default gen_random_uuid(), job_id uuid unique, status text default 'draft', piesa_outcome text default 'pending',
    switchboard_condition text, notes text, assessor_id uuid, external_mitti_id text, assessed_on date);
  CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
`);
for (const s of [fn(CORE, "has_role"), fn(CORE, "is_admin"), fn(CORE, "is_job_owner"), fn(P23, "is_business_member"), fn(P115, "job_assignment_role"), fn(P147, "can_access_job"), fn(CORE, "my_job_role")]) await db.exec(s);
await db.exec(`
  GRANT USAGE ON SCHEMA auth, public TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;
  INSERT INTO public.user_roles VALUES ('${U.sparky}','electrician'), ('${U.office}','admin'), ('${U.stranger}','owner'), ('${U.ownerA}','owner');
  INSERT INTO public.businesses VALUES ('${BIZ.recA}','approved');
  INSERT INTO public.owners VALUES ('${OWN.a}','${U.ownerA}');
  INSERT INTO public.jobs (id, owner_id, stage, source) VALUES
    ('${JOB.withDraft}','${OWN.a}','piesa_scheduled','qa_test'), ('${JOB.noDraft}','${OWN.a}','piesa_scheduled','qa_test');
  INSERT INTO public.job_assignments (job_id, user_id, business_id, role, active) VALUES
    ('${JOB.withDraft}','${U.sparky}','${BIZ.recA}','electrician',true), ('${JOB.noDraft}','${U.sparky}','${BIZ.recA}','electrician',true);
`);

/** Run SQL as an end user: role authenticated + auth.uid() (what Supabase does for the caller's own client). */
async function as<T>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return (await tx.query<T>(sql, params)).rows;
  });
}
/** The caller's RLS-scoped client as the server functions see it (context.supabase). */
function userClient(uid: string) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: uid, user_metadata: {} } }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const keys = Object.keys(args);
      try {
        const rows = await as<{ v: unknown }>(uid, `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) AS v`, keys.map((k) => args[k]));
        return { data: rows[0]?.v ?? null, error: null };
      } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
    },
  };
}
const admin = postgrestShim(db);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null, autoAdvanceOpenJobs: async () => ({}), loadAdvanceFacts: async () => ({}) }));

const { saveAssessment } = await import("../src/lib/portal.functions");
const { PIESA_DATE_IN_FUTURE } = await import("../src/lib/piesa-date.core");

const call = (uid: string, data: unknown) => (saveAssessment as unknown as Call)({ data, context: { supabase: userClient(uid), userId: uid } });
const outcome = async (p: Promise<unknown>) => { try { return { ok: true as const, value: await p }; } catch (e) { return { ok: false as const, error: (e as Error).message }; } };

/** Full row snapshot so "unchanged" is proven field by field, not just for assessed_on. */
const row = async (job: string) => (await db.query<Record<string, unknown>>("select id, job_id, status, piesa_outcome, switchboard_condition, notes, assessor_id, external_mitti_id, assessed_on from assessments where job_id = $1", [job])).rows[0] ?? null;
const norm = (r: Record<string, unknown> | null) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));
const events = async (job: string) => (await db.query("select 1 from workflow_events where job_id = $1", [job])).rows.length;
const stage = async (job: string) => (await db.query<{ stage: string }>("select stage from jobs where id = $1", [job])).rows[0]!.stage;

// ---- dates (Melbourne is authoritative) ----
const today = melbourneToday();
const shift = (ymd: string, days: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const YESTERDAY = shift(today, -1), TOMORROW = shift(today, 1), NEXT_MONTH = shift(today, 30);

// Fixture: an existing draft with a VALID historical assessment date.
const SEED = { status: "draft", piesa_outcome: "pending", switchboard_condition: "ok", notes: "TEST fixture draft", assessed_on: YESTERDAY } as const;

describe("harness integrity (the evidence is only meaningful if these hold)", () => {
  test("environment is isolated: no Production credentials, no outbound network", () => {
    expect(process.env["ALLOW_PROD_SUPABASE"]).toBeUndefined();
    for (const k of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
      const v = process.env[k];
      if (v) expect(v).toMatch(/127\.0\.0\.1|localhost/); // only ever the local stack
    }
  });
  test("authorization is answered by Postgres as the caller, not by the shim", async () => {
    expect((await as<{ r: string | null }>(U.sparky, "SELECT public.my_job_role($1) AS r", [JOB.withDraft]))[0]!.r).toBe("electrician");
    expect((await as<{ r: string | null }>(U.stranger, "SELECT public.my_job_role($1) AS r", [JOB.withDraft]))[0]!.r).toBeNull();
  });
  test("the caller really is authorized on the fixture job (so a refusal cannot be a permission error)", async () => {
    const r = await outcome(call(U.sparky, { jobId: JOB.withDraft, patch: { notes: "authz probe" } }));
    expect(r.ok).toBe(true);
    await db.exec(`DELETE FROM public.assessments WHERE job_id = '${JOB.withDraft}'`);
  });
});

describe("FIX #2 · saveAssessment refuses a future PIESA date before any database change", () => {
  test("TOMORROW is refused and the existing row is byte-for-byte unchanged", async () => {
    await db.exec(`INSERT INTO public.assessments (job_id, status, piesa_outcome, switchboard_condition, notes, assessed_on) VALUES ('${JOB.withDraft}','${SEED.status}','${SEED.piesa_outcome}','${SEED.switchboard_condition}','${SEED.notes}','${SEED.assessed_on}')`);
    const before = norm(await row(JOB.withDraft));
    expect(before?.["assessed_on"]).toBe(YESTERDAY); // fixture recorded

    const request = { jobId: JOB.withDraft, patch: { assessed_on: TOMORROW, piesa_outcome: "pass" } };
    const r = await outcome(call(U.sparky, request));
    console.log(`\n[Melbourne today]  ${today}`);
    console.log(`[request]          saveAssessment ${JSON.stringify(request)}`);
    console.log(`[response]         ${r.ok ? JSON.stringify(r.value) : r.error}`);

    expect(r).toEqual({ ok: false, error: PIESA_DATE_IN_FUTURE });
    expect(r.ok ? "" : r.error).toBe("PIESA date cannot be in the future.");

    const after = norm(await row(JOB.withDraft));
    console.log(`[db before]        ${JSON.stringify(before)}`);
    console.log(`[db after]         ${JSON.stringify(after)}`);
    expect(after).toEqual(before);
    expect(after?.["assessed_on"]).toBe(YESTERDAY);
    expect(after?.["piesa_outcome"]).toBe("pending");
    expect(await events(JOB.withDraft)).toBe(0);
    expect(await stage(JOB.withDraft)).toBe("piesa_scheduled");
  });

  test("a date 30 days out is refused too (not just tomorrow)", async () => {
    const before = norm(await row(JOB.withDraft));
    const r = await outcome(call(U.sparky, { jobId: JOB.withDraft, patch: { assessed_on: NEXT_MONTH } }));
    expect(r).toEqual({ ok: false, error: PIESA_DATE_IN_FUTURE });
    expect(norm(await row(JOB.withDraft))).toEqual(before);
  });

  test("no assessment row exists: the refusal happens before the INSERT (no row is created)", async () => {
    expect(await row(JOB.noDraft)).toBeNull();
    const r = await outcome(call(U.sparky, { jobId: JOB.noDraft, patch: { assessed_on: TOMORROW, piesa_outcome: "pass" } }));
    expect(r).toEqual({ ok: false, error: PIESA_DATE_IN_FUTURE });
    expect(await row(JOB.noDraft)).toBeNull();
    expect(await events(JOB.noDraft)).toBe(0);
  });
});

describe("control · the same path ACCEPTS yesterday and today (the refusal is the date rule, not a broken harness)", () => {
  test("yesterday is written", async () => {
    const r = await outcome(call(U.sparky, { jobId: JOB.withDraft, patch: { assessed_on: YESTERDAY, piesa_outcome: "pass" } }));
    expect(r.ok).toBe(true);
    expect(norm(await row(JOB.withDraft))?.["assessed_on"]).toBe(YESTERDAY);
    expect((await row(JOB.withDraft))!["piesa_outcome"]).toBe("pass");
  });
  test("today is written", async () => {
    const r = await outcome(call(U.sparky, { jobId: JOB.withDraft, patch: { assessed_on: today, piesa_outcome: "pass" } }));
    expect(r.ok).toBe(true);
    expect(norm(await row(JOB.withDraft))?.["assessed_on"]).toBe(today);
  });
  test("a future date is still refused after valid dates were saved", async () => {
    const before = norm(await row(JOB.withDraft));
    expect((await outcome(call(U.sparky, { jobId: JOB.withDraft, patch: { assessed_on: TOMORROW } }))).error).toBe(PIESA_DATE_IN_FUTURE);
    expect(norm(await row(JOB.withDraft))).toEqual(before);
  });
});

describe("isolation proof", () => {
  test("no outbound HTTP was made at any point (Production never contacted)", () => {
    expect(net).toEqual([]);
  });
});
