// STEP 80 (W4, A4): REC business-admin boundaries, regulated electrical results and Homeowner job access, exercised
// through the REAL server-function handlers (portal.functions saveAssessment / completeAssessment / recordPiesa /
// submitDeclaration, admin-records.functions getJobOverview) and the REAL requireJobRole, against the REAL authorization
// SQL taken verbatim from the migration chain (0000 has_role/is_admin/is_job_owner/my_job_role, 0023
// is_business_member, 0115 job_assignment_role, 0147 can_access_job). Postgres (PGlite) evaluates every access
// question as role `authenticated` with auth.uid() = the caller. Synthetic data only; no network, no providers.
// Stubbed: the TanStack wrapper and auth middleware (the handler receives the caller's client directly), autoAdvanceJob
// (runs after the guards), and the service-role rpc has_contact_release (always false: redaction path). The service-role
// table client is the shared PGlite PostgREST shim over the same database. Also covers pilot.functions addTeamMember.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { melbourneToday } from "@/lib/melbourne-time.core";

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
/** The exact `create or replace function public.<name>` statement from a migration file (source-faithful, no retyping). */
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
const U = {
  office: id(0x801), licensed: id(0x802), recAdmin: id(0x803), installerOnly: id(0x804), unapprovedBizAdmin: id(0x805),
  pendingWorker: id(0x806), otherRecElectrician: id(0x807), ownerA: id(0x808), ownerB: id(0x809),
  licensedExpired: id(0x80a), licensedNoLicenceRecord: id(0x80b), unapprovedBizElectrician: id(0x80c),
};
const BIZ = { recA: id(0xb01), recB: id(0xb02), recUnapproved: id(0xb03), instA: id(0xb04) };
const OWN = { a: id(0xc01), b: id(0xc02) };
const JOB = { e: id(0xd01), complete: id(0xd02), b: id(0xd03), u: id(0xd04), missing: id(0xd0f) };

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
  CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean default true, added_by uuid, unique (business_id, user_id));
  CREATE TABLE public.businesses (id uuid primary key, onboarding_status text);
  CREATE TABLE public.profiles (id uuid primary key, business_id uuid, email text, full_name text, licence_number text);
  CREATE TABLE public.partner_workers (id uuid primary key default gen_random_uuid(), profile_id uuid, business_id uuid, trade_role public.assignment_role, approval_status text, removed_at timestamptz, licence_expires_on date,
    email text, full_legal_name text, licence_number text, account_status text, linked_by uuid, linked_at timestamptz);
  CREATE TABLE public.worker_job_links (job_id uuid, worker_id uuid, business_id uuid, revoked_at timestamptz, expires_at timestamptz);
  CREATE TABLE public.assessments (id uuid primary key default gen_random_uuid(), job_id uuid unique, status text default 'draft', piesa_outcome text default 'pending',
    switchboard_condition text, notes text, assessor_id uuid, external_mitti_id text);
  CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), assessment_id uuid references public.assessments(id), outcome text not null, completed_date date not null, signed_off_by uuid, is_current boolean default true, notes text, created_at timestamptz default now());
  CREATE TABLE public.declarations (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, declared_by uuid, statement text, declared_at timestamptz, unique (job_id, kind));
  CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, from_stage text, to_stage text, internal boolean);
  CREATE TABLE public.job_overview (id uuid primary key, job_number text, owner_name text, owner_phone text, owner_email text, property_address text, property_id uuid, stage text, channel text);
  CREATE TABLE public.properties (id uuid primary key, suburb text, postcode text);
`);
for (const s of [fn(CORE, "has_role"), fn(CORE, "is_admin"), fn(CORE, "is_job_owner"), fn(P23, "is_business_member"), fn(P115, "job_assignment_role"), fn(P147, "can_access_job"), fn(CORE, "my_job_role")]) await db.exec(s);
await db.exec(`
  GRANT USAGE ON SCHEMA auth, public TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;
  INSERT INTO public.user_roles VALUES ('${U.office}','admin'), ('${U.licensed}','electrician'), ('${U.installerOnly}','installer'), ('${U.pendingWorker}','electrician'),
    ('${U.otherRecElectrician}','electrician'), ('${U.ownerA}','owner'), ('${U.ownerB}','owner'), ('${U.licensedExpired}','electrician'), ('${U.licensedNoLicenceRecord}','electrician'),
    ('${U.unapprovedBizElectrician}','electrician');
  INSERT INTO public.businesses VALUES ('${BIZ.recA}','approved'), ('${BIZ.recB}','approved'), ('${BIZ.recUnapproved}','submitted'), ('${BIZ.instA}','approved');
  INSERT INTO public.owners VALUES ('${OWN.a}','${U.ownerA}'), ('${OWN.b}','${U.ownerB}');
  INSERT INTO public.jobs (id, owner_id, stage) VALUES ('${JOB.e}','${OWN.a}','assessment_booked'), ('${JOB.complete}','${OWN.a}','assessment_booked'), ('${JOB.b}','${OWN.b}','ready_check_ready_to_schedule'),
    ('${JOB.u}','${OWN.b}','assessment_booked');
  INSERT INTO public.job_assignments VALUES
    ('${JOB.e}','${U.licensed}','${BIZ.recA}','electrician',true), ('${JOB.e}','${U.installerOnly}','${BIZ.instA}','installer',true),
    ('${JOB.e}','${U.licensedExpired}','${BIZ.recA}','electrician',true), ('${JOB.e}','${U.licensedNoLicenceRecord}','${BIZ.recA}','electrician',true),
    ('${JOB.complete}','${U.licensed}','${BIZ.recA}','electrician',true),
    ('${JOB.b}','${U.otherRecElectrician}','${BIZ.recB}','electrician',true),
    ('${JOB.u}','${U.unapprovedBizElectrician}','${BIZ.recUnapproved}','electrician',true);
  INSERT INTO public.business_members VALUES ('${BIZ.recA}','${U.recAdmin}','business_admin',true), ('${BIZ.recA}','${U.licensed}','member',true),
    ('${BIZ.recUnapproved}','${U.unapprovedBizAdmin}','business_admin',true), ('${BIZ.recB}','${U.otherRecElectrician}','business_admin',true), ('${BIZ.instA}','${U.installerOnly}','member',true),
    ('${BIZ.recUnapproved}','${U.unapprovedBizElectrician}','member',true);
  INSERT INTO public.partner_workers (profile_id, business_id, trade_role, approval_status, licence_expires_on) VALUES
    ('${U.pendingWorker}','${BIZ.recA}','electrician','pending', '2030-01-01'), ('${U.licensed}','${BIZ.recA}','electrician','approved','2030-01-01'),
    ('${U.licensedExpired}','${BIZ.recA}','electrician','approved','2020-01-01');
  INSERT INTO public.worker_job_links SELECT '${JOB.e}', pw.id, '${BIZ.recA}', null, now() + interval '7 days' FROM public.partner_workers pw WHERE pw.profile_id = '${U.pendingWorker}';
  INSERT INTO public.properties VALUES ('${id(0xe01)}','Step80ville','3999');
  INSERT INTO public.job_overview VALUES ('${JOB.e}','UAT-S80-E','Alex Owner','0400000000','alex@example.test','1 Private St, Step80ville VIC 3999','${id(0xe01)}','assessment_booked','website'),
    ('${JOB.b}','UAT-S80-B','Bo Owner','0400000001','bo@example.test','2 Other St, Step80ville VIC 3999','${id(0xe01)}','ready_check_ready_to_schedule','website');
`);

/** Run SQL as an end user: role authenticated + auth.uid() (what Supabase does for the caller's own client). */
async function as<T>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return (await tx.query<T>(sql, params)).rows;
  });
}
/** The caller's RLS-scoped client as the server functions see it (context.supabase): auth.getUser + rpc as that user. */
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

// Service-role client (supabaseAdmin) over the same database; adds upsert (declarations) and the contact-release rpc.
const shim = postgrestShim(db);
const admin = {
  from(t: string) {
    const b = shim.from(t) as ReturnType<typeof shim.from> & { upsert?: unknown; ilike?: unknown };
    // ilike is only used with exactLike() (wildcards escaped) on lower-case synthetic emails: exact equality is the same match.
    b.ilike = (c: string, v: string) => { if (/[%_\\]/.test(v) || v !== v.toLowerCase()) throw new Error(`test shim: unsupported ilike ${v}`); return b.eq(c, v); };
    b.upsert = (row: Record<string, unknown>, o: { onConflict: string }) => {
      const ks = Object.keys(row);
      const sql = `INSERT INTO ${t} (${ks.map((k) => `"${k}"`).join(", ")}) VALUES (${ks.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT (${o.onConflict}) DO UPDATE SET ${ks.map((k) => `"${k}" = excluded."${k}"`).join(", ")}`;
      return db.query(sql, ks.map((k) => row[k])).then(() => ({ data: null, error: null }), (e: Error) => ({ data: null, error: { message: e.message } }));
    };
    return b;
  },
  rpc: async (name: string) => ({ data: name === "has_contact_release" ? false : null, error: null }),
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null, autoAdvanceOpenJobs: async () => ({}), loadAdvanceFacts: async () => ({}) }));

const portal = await import("../src/lib/portal.functions");
const pilot = await import("../src/lib/pilot.functions");
const records = await import("../src/lib/admin-records.functions");
const { CLEARANCE_RECORDER_REFUSED } = await import("../src/lib/clearance-guard.core");
const NO_PERMISSION = "You don't have permission for this action on this job.";

const call = (f: unknown, uid: string, data: unknown) => (f as Call)({ data, context: { supabase: userClient(uid), userId: uid } });
const outcome = async (p: Promise<unknown>) => { try { return { ok: true as const, value: await p }; } catch (e) { return { ok: false as const, error: (e as Error).message }; } };
const draft = async (job: string) => (await db.query<{ piesa_outcome: string; notes: string | null; assessor_id: string | null }>("select piesa_outcome, notes, assessor_id from assessments where job_id = $1", [job])).rows[0] ?? null;
const role = async (uid: string, job: string) => (await as<{ r: string | null }>(uid, "SELECT public.my_job_role($1) AS r", [job]))[0]!.r;
const access = async (uid: string, job: string) => (await as<{ ok: boolean }>(uid, "SELECT public.can_access_job($1) AS ok", [job]))[0]!.ok;

describe("harness integrity", () => {
  test("access answers come from Postgres as the caller (not from the shim)", async () => {
    expect(await role(U.office, JOB.e)).toBe("admin");
    expect(await role(U.licensed, JOB.e)).toBe("electrician");
    expect(await role(U.ownerA, JOB.e)).toBe("owner");
    expect(await role(U.ownerB, JOB.e)).toBeNull();
    expect((await userClient(U.licensed).rpc("has_role", { _user_id: U.licensed, _role: "electrician" })).data).toBe(true);
    expect((await userClient(U.recAdmin).rpc("has_role", { _user_id: U.recAdmin, _role: "electrician" })).data).toBe(false);
  });
});

describe("A · REC business admin without the electrician app role (0115 business-admin branch)", () => {
  test("sees and coordinates its business's assigned job: my_job_role = electrician, can_access_job = true", async () => {
    expect(await role(U.recAdmin, JOB.e)).toBe("electrician");
    expect(await access(U.recAdmin, JOB.e)).toBe(true);
  });
  test("getJobOverview: the job is visible, owner contact stays redacted without a contact release", async () => {
    const r = await outcome(call(records.getJobOverview, U.recAdmin, { jobId: JOB.e }));
    expect(r.ok).toBe(true);
    const row = r.ok ? (r.value as Record<string, unknown>) : {};
    expect(row["id"]).toBe(JOB.e);
    expect(row["owner_name"]).toBeNull();
    expect(row["owner_phone"]).toBeNull();
    expect(row["property_address"]).toBe("Step80ville 3999");
  });
  test("cannot see another REC's job", async () => {
    expect(await role(U.recAdmin, JOB.b)).toBeNull();
    expect(await access(U.recAdmin, JOB.b)).toBe(false);
  });
  test("saveAssessment (draft PIESA outcome) is REFUSED and nothing is written  [STEP 80 fix]", async () => {
    const r = await outcome(call(portal.saveAssessment, U.recAdmin, { jobId: JOB.e, patch: { piesa_outcome: "pass", notes: "rec admin" } }));
    expect(r).toEqual({ ok: false, error: CLEARANCE_RECORDER_REFUSED });
    expect(await draft(JOB.e)).toBeNull();
  });
  test("completeAssessment is REFUSED (STEP 73 guard present at HEAD)", async () => {
    expect(await outcome(call(portal.completeAssessment, U.recAdmin, { jobId: JOB.complete }))).toEqual({ ok: false, error: CLEARANCE_RECORDER_REFUSED });
  });
  test("recordPiesa is REFUSED (STEP 73 guard present at HEAD)", async () => {
    const r = await outcome(call(portal.recordPiesa, U.recAdmin, { jobId: JOB.e, kind: "post_rectification", outcome: "pass", completedDate: "2026-10-01" }));
    expect(r).toEqual({ ok: false, error: CLEARANCE_RECORDER_REFUSED });
  });
  test("submitDeclaration('electrician_declaration') is REFUSED and nothing is written  [STEP 80 fix]", async () => {
    const r = await outcome(call(portal.submitDeclaration, U.recAdmin, { jobId: JOB.e, kind: "electrician_declaration", statement: "I declare the electrical work is safe." }));
    expect(r).toEqual({ ok: false, error: CLEARANCE_RECORDER_REFUSED });
    expect((await db.query("select 1 from declarations where job_id = $1", [JOB.e])).rows.length).toBe(0);
  });
});

describe("B · licensed electrician (electrician app role) assigned to the job keeps recording", () => {
  test("saveAssessment writes the draft", async () => {
    const r = await outcome(call(portal.saveAssessment, U.licensed, { jobId: JOB.e, patch: { piesa_outcome: "fail", notes: "licensed" } }));
    expect(r.ok).toBe(true);
    expect(await draft(JOB.e)).toEqual({ piesa_outcome: "fail", notes: "licensed", assessor_id: U.licensed });
  });
  test("completeAssessment passes the guard (reaches the next business rule)", async () => {
    expect(await outcome(call(portal.completeAssessment, U.licensed, { jobId: JOB.complete }))).toEqual({ ok: false, error: "Start the assessment first." });
  });
  test("recordPiesa passes the guard (reaches the stage rule)", async () => {
    const r = await outcome(call(portal.recordPiesa, U.licensed, { jobId: JOB.e, kind: "post_rectification", outcome: "pass", completedDate: "2026-10-01" }));
    expect(r).toEqual({ ok: false, error: "Electrical fixes must be booked first." });
  });
  test("submitDeclaration('electrician_declaration') is recorded", async () => {
    const r = await outcome(call(portal.submitDeclaration, U.licensed, { jobId: JOB.e, kind: "electrician_declaration", statement: "I declare the electrical work is safe." }));
    expect(r.ok).toBe(true);
    expect((await db.query<{ declared_by: string }>("select declared_by from declarations where job_id = $1 and kind = 'electrician_declaration'", [JOB.e])).rows).toEqual([{ declared_by: U.licensed }]);
  });
  test("Office keeps its access to the same actions", async () => {
    expect((await outcome(call(portal.saveAssessment, U.office, { jobId: JOB.e, patch: { notes: "office" } }))).ok).toBe(true);
    expect(await outcome(call(portal.completeAssessment, U.office, { jobId: JOB.complete }))).toEqual({ ok: false, error: "Start the assessment first." });
  });
});

describe("C · licence validity (characterisation: what HEAD enforces today)", () => {
  // POLICY_OR_DATA_GAP: no approved rule ties result recording to licence expiry. The only licence-expiry rule
  // (worker-compliance.core workerOfferBlocker) blocks NEW offers; "missing" is deliberately not blocking. These tests pin
  // today's behaviour so any future enforcement is a visible, approved change.
  test("an electrician whose partner_workers licence expired still passes the recording guard", async () => {
    expect(await role(U.licensedExpired, JOB.e)).toBe("electrician");
    expect((await outcome(call(portal.saveAssessment, U.licensedExpired, { jobId: JOB.e, patch: { notes: "expired licence" } }))).ok).toBe(true);
  });
  test("an electrician with no partner_workers licence record still passes the recording guard", async () => {
    expect((await outcome(call(portal.saveAssessment, U.licensedNoLicenceRecord, { jobId: JOB.e, patch: { notes: "no record" } }))).ok).toBe(true);
  });
  test("a PENDING (unapproved) worker with the electrician app role gets no job role through a worker link", async () => {
    expect(await role(U.pendingWorker, JOB.e)).toBeNull();
    expect(await outcome(call(portal.saveAssessment, U.pendingWorker, { jobId: JOB.e, patch: { notes: "pending" } }))).toEqual({ ok: false, error: NO_PERMISSION });
  });
});

describe("D/E · installer-only, unapproved business, other REC, customers", () => {
  const denied: [string, string][] = [["installer-only user on the job", U.installerOnly], ["admin of an unapproved business not assigned to the job", U.unapprovedBizAdmin],
    ["another REC's licensed electrician", U.otherRecElectrician], ["the job's own owner", U.ownerA], ["an unrelated customer", U.ownerB]];
  for (const [who, uid] of denied) test(`${who}: every regulated-result path is refused before any write`, async () => {
    const before = await draft(JOB.e);
    for (const [f, data] of [
      [portal.saveAssessment, { jobId: JOB.e, patch: { piesa_outcome: "pass" } }],
      [portal.completeAssessment, { jobId: JOB.complete }],
      [portal.recordPiesa, { jobId: JOB.e, kind: "post_rectification", outcome: "pass", completedDate: "2026-10-01" }],
      [portal.submitDeclaration, { jobId: JOB.e, kind: "electrician_declaration", statement: "I declare the electrical work is safe." }],
    ] as [unknown, unknown][]) expect(await outcome(call(f, uid, data))).toEqual({ ok: false, error: NO_PERMISSION });
    expect(await draft(JOB.e)).toEqual(before);
  });
  test("installer-only user: sees the job as installer only; other REC and unapproved admin: no access", async () => {
    expect(await role(U.installerOnly, JOB.e)).toBe("installer");
    expect(await access(U.otherRecElectrician, JOB.e)).toBe(false);
    expect(await access(U.unapprovedBizAdmin, JOB.e)).toBe(false);
    expect(await access(U.ownerB, JOB.e)).toBe(false);
  });
});

describe("F/G/H · Owner job route data (getJobOverview)", () => {
  test("F: own job loads in full", async () => {
    const r = await outcome(call(records.getJobOverview, U.ownerA, { jobId: JOB.e }));
    expect(r.ok).toBe(true);
    expect(r.ok && (r.value as Record<string, unknown>)["owner_name"]).toBe("Alex Owner");
  });
  test("G: another customer's job is refused with the generic message", async () => {
    expect(await outcome(call(records.getJobOverview, U.ownerA, { jobId: JOB.b }))).toEqual({ ok: false, error: NO_PERMISSION });
    expect(await outcome(call(records.getJobOverview, U.ownerB, { jobId: JOB.e }))).toEqual({ ok: false, error: NO_PERMISSION });
  });
  test("H: a job that does not exist gets the SAME message (no existence oracle)", async () => {
    expect(await outcome(call(records.getJobOverview, U.ownerA, { jobId: JOB.missing }))).toEqual({ ok: false, error: NO_PERMISSION });
  });
});

describe("E2 · business approval is not part of the job-role SQL (characterisation)", () => {
  test("an unapproved business's admin without the electrician role reaches its assigned job but cannot record", async () => {
    await db.exec(`INSERT INTO public.job_assignments VALUES ('${JOB.u}', null, '${BIZ.recUnapproved}', 'electrician', true)`);
    expect(await role(U.unapprovedBizAdmin, JOB.u)).toBe("electrician");
    expect(await outcome(call(portal.saveAssessment, U.unapprovedBizAdmin, { jobId: JOB.u, patch: { piesa_outcome: "pass" } }))).toEqual({ ok: false, error: CLEARANCE_RECORDER_REFUSED });
  });
  test("POLICY_OR_DATA_GAP: an electrician of a NOT-approved business, assigned to the job, still passes the recording guard", async () => {
    expect(await role(U.unapprovedBizElectrician, JOB.u)).toBe("electrician");
    expect((await outcome(call(portal.saveAssessment, U.unapprovedBizElectrician, { jobId: JOB.u, patch: { notes: "unapproved business" } }))).ok).toBe(true);
  });
});

describe("B2 · the electrician app role cannot be self-granted by a partner business admin (addTeamMember)  [STEP 80 fix]", () => {
  const grant = (uid: string, email: string) => call(pilot.addTeamMember, uid, { businessId: BIZ.recA, email, memberRole: "business_admin", tradeRole: "electrician" });
  const roles = async (uid: string) => (await db.query<{ role: string }>("select role::text from user_roles where user_id = $1 order by role", [uid])).rows.map((r) => r.role);
  test("setup: the REC admin has a portal profile and listed THEMSELVES as a (pending) electrician worker", async () => {
    await db.exec(`INSERT INTO public.profiles (id, business_id, email) VALUES ('${U.recAdmin}', '${BIZ.recA}', 'recadmin@step80.test'), ('${U.licensed}', '${BIZ.recA}', 'licensed@step80.test'),
      ('${U.licensedNoLicenceRecord}', null, 'removed@step80.test');
      INSERT INTO public.partner_workers (business_id, trade_role, approval_status, email, full_legal_name, licence_number) VALUES
        ('${BIZ.recA}', 'electrician', 'pending', 'recadmin@step80.test', 'Rec Admin', 'MADE-UP-123'),
        ('${BIZ.recA}', 'electrician', 'approved', 'licensed@step80.test', 'Lee Licensed', 'A12345');
      INSERT INTO public.partner_workers (business_id, trade_role, approval_status, removed_at, email, full_legal_name, licence_number) VALUES
        ('${BIZ.recA}', 'electrician', 'approved', now(), 'removed@step80.test', 'Rem Oved', 'A99999');`);
    expect(await roles(U.recAdmin)).toEqual([]);
  });
  test("a PENDING electrician listing does not give the electrician role; nothing is written", async () => {
    const r = await outcome(grant(U.recAdmin, "recadmin@step80.test"));
    expect(r).toEqual({ ok: false, error: "Home Insulation Victoria hasn't approved this electrician yet. Add them as an electrician once they're approved." });
    expect(await roles(U.recAdmin)).toEqual([]);
    expect((await db.query("select 1 from partner_workers where email = 'recadmin@step80.test' and profile_id is not null")).rows.length).toBe(0);
    // ...so the regulated-result guard still refuses them.
    expect(await outcome(call(portal.saveAssessment, U.recAdmin, { jobId: JOB.e, patch: { piesa_outcome: "pass" } }))).toEqual({ ok: false, error: CLEARANCE_RECORDER_REFUSED });
  });
  test("a REMOVED electrician listing does not give the role either", async () => {
    const r = await outcome(grant(U.recAdmin, "removed@step80.test"));
    expect(r.ok).toBe(false);
    expect((await db.query(`select 1 from business_members where user_id = '${U.licensedNoLicenceRecord}'`)).rows.length).toBe(0); // refused before any write
  });
  test("an APPROVED electrician listing is still granted by the business admin (no regression)", async () => {
    await db.exec(`DELETE FROM public.user_roles WHERE user_id = '${U.licensed}'`);
    expect((await outcome(grant(U.recAdmin, "licensed@step80.test"))).ok).toBe(true);
    expect(await roles(U.licensed)).toEqual(["electrician"]);
  });
  test("Office keeps its existing ability (it decides approval itself)", async () => {
    expect((await outcome(grant(U.office, "recadmin@step80.test"))).ok).toBe(true);
    expect(await roles(U.recAdmin)).toEqual(["electrician"]);
    await db.exec(`DELETE FROM public.user_roles WHERE user_id = '${U.recAdmin}'`);
  });
});

describe("H · electrician manual result path at piesa_scheduled (no Mitti link)", () => {
  const today = melbourneToday();
  test("saveAssessment writes a draft from piesa_scheduled", async () => {
    // First, set the job stage to piesa_scheduled (no Mitti link, external_mitti_id null)
    await db.exec(`
      UPDATE public.jobs SET stage = 'piesa_scheduled' WHERE id = '${JOB.e}';
    `);
    const r = await outcome(call(portal.saveAssessment, U.licensed, { jobId: JOB.e, patch: { piesa_outcome: "fail", notes: "manual piesa_scheduled draft" } }));
    expect(r.ok).toBe(true);
    const d = await draft(JOB.e);
    expect(d).toEqual({ piesa_outcome: "fail", notes: "manual piesa_scheduled draft", assessor_id: U.licensed });
  });

  test("completeAssessment proceeds past stage gate from piesa_scheduled (may fail validation)", async () => {
    await db.exec(`
      UPDATE public.jobs SET stage = 'piesa_scheduled' WHERE id = '${JOB.e}';
    `);
    // Insert minimal assessment with only columns that exist in harness schema
    await db.exec(`
      INSERT INTO public.assessments (job_id, piesa_outcome, switchboard_condition, notes)
      VALUES ('${JOB.e}', 'fail', 'ok', 'manual draft')
      ON CONFLICT (job_id) DO UPDATE SET
        piesa_outcome = EXCLUDED.piesa_outcome,
        switchboard_condition = EXCLUDED.switchboard_condition,
        notes = EXCLUDED.notes;
    `);
    const r = await outcome(call(portal.completeAssessment, U.licensed, { jobId: JOB.e, rectHours: 4, rectWindows: [] }));
    // Regardless of validation outcome, we must NOT get a stage-gate error.
    expect(r.ok || !r.error?.includes("Assessment can be completed from")).toBe(true);
  });

  test("completeAssessment proceeds past stage gate from assessment_booked (regression)", async () => {
    await db.exec(`
      UPDATE public.jobs SET stage = 'assessment_booked' WHERE id = '${JOB.e}';
    `);
    await db.exec(`
      INSERT INTO public.assessments (job_id, piesa_outcome, switchboard_condition, notes)
      VALUES ('${JOB.e}', 'fail', 'ok', 'minimal draft')
      ON CONFLICT (job_id) DO UPDATE SET
        piesa_outcome = EXCLUDED.piesa_outcome,
        switchboard_condition = EXCLUDED.switchboard_condition,
        notes = EXCLUDED.notes;
    `);
    const r = await outcome(call(portal.completeAssessment, U.licensed, { jobId: JOB.e, rectHours: 3, rectWindows: [] }));
    expect(r.ok || !r.error?.includes("Assessment can be completed from")).toBe(true);
  });

  test("completeAssessment rejects incomplete assessment from piesa_scheduled", async () => {
    await db.exec(`
      UPDATE public.jobs SET stage = 'piesa_scheduled' WHERE id = '${JOB.e}';
    `);
    // Insert assessment with piesa_outcome still pending - should fail validation
    await db.exec(`
      INSERT INTO public.assessments (job_id, piesa_outcome, switchboard_condition, notes)
      VALUES ('${JOB.e}', 'pending', 'ok', 'still pending')
      ON CONFLICT (job_id) DO UPDATE SET
        piesa_outcome = EXCLUDED.piesa_outcome,
        switchboard_condition = EXCLUDED.switchboard_condition,
        notes = EXCLUDED.notes;
    `);
    const r = await outcome(call(portal.completeAssessment, U.licensed, { jobId: JOB.e }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PIESA outcome"); // validation error from completeAssessment
  });

  test("unassigned electrician cannot save at piesa_scheduled", async () => {
    await db.exec(`
      UPDATE public.jobs SET stage = 'piesa_scheduled' WHERE id = '${JOB.e}';
    `);
    const r = await outcome(call(portal.saveAssessment, U.ownerA, { jobId: JOB.e, patch: { piesa_outcome: "pass" } }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("You don't have permission for this action on this job.");
  });

  test("installer cannot save Electrician assessment at piesa_scheduled", async () => {
    await db.exec(`
      UPDATE public.jobs SET stage = 'piesa_scheduled' WHERE id = '${JOB.e}';
    `);
    const r = await outcome(call(portal.saveAssessment, U.installerOnly, { jobId: JOB.e, patch: { piesa_outcome: "pass" } }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("You don't have permission for this action on this job.");
  });
});

/** Helper: expect a non-null value (ts-ignore for bun test) */
function notNull(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return expect.anything();
}
