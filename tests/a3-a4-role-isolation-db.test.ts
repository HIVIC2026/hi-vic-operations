// STEP 73 (W4, A3/A4): five-role job isolation against the REAL authorization functions, extracted verbatim from the
// migration chain (0000 core: has_role/is_admin/is_job_owner/my_job_role; 0023: is_business_member; 0115:
// job_assignment_role incl. the business-admin (FFS) branch; 0147: can_access_job with the soft-delete guard, plus the
// 0023 variant). Executed by Postgres (PGlite) as role `authenticated` with auth.uid() = request.jwt.claim.sub.
// my_job_role is what every requireJobRole() server guard uses; can_access_job is the RLS job boundary. Synthetic data.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { intakeProgressGate } from "../src/lib/installer-progress.core";
import { clearanceRecorderAllowed } from "../src/lib/clearance-guard.core";

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

const U = {
  office: "00000000-0000-4000-8000-000000000001", ownerA: "00000000-0000-4000-8000-000000000002", ownerB: "00000000-0000-4000-8000-000000000003",
  installerA: "00000000-0000-4000-8000-000000000004", installerB: "00000000-0000-4000-8000-000000000005", electricianA: "00000000-0000-4000-8000-000000000006",
  ffsBossA: "00000000-0000-4000-8000-000000000007", ffsBossB: "00000000-0000-4000-8000-000000000008", workerA: "00000000-0000-4000-8000-000000000009",
  unapproved: "00000000-0000-4000-8000-00000000000a",
  recAdminNoRole: "00000000-0000-4000-8000-00000000000b", // admin of the electrician business, added with trade role "none"
};
const BIZ = { instA: "00000000-0000-4000-8000-0000000000b1", instB: "00000000-0000-4000-8000-0000000000b2", elecA: "00000000-0000-4000-8000-0000000000b3" };
const OWN = { a: "00000000-0000-4000-8000-0000000000c1", b: "00000000-0000-4000-8000-0000000000c2" };
const JOB = { a: "00000000-0000-4000-8000-0000000000d1", b: "00000000-0000-4000-8000-0000000000d2", deleted: "00000000-0000-4000-8000-0000000000d3" };

async function database(canAccessFrom: "0147" | "0023") {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.app_role as enum ('admin','electrician','installer','owner','property_manager');
    create type public.assignment_role as enum ('electrician','installer','property_manager');
    CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
    CREATE TABLE public.owners (id uuid primary key, user_id uuid);
    CREATE TABLE public.jobs (id uuid primary key, owner_id uuid, deleted_at timestamptz);
    CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, business_id uuid, role public.assignment_role, active boolean default true);
    CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean default true);
    CREATE TABLE public.profiles (id uuid primary key, business_id uuid);
    CREATE TABLE public.partner_workers (id uuid primary key, profile_id uuid, trade_role public.assignment_role, approval_status text, removed_at timestamptz);
    CREATE TABLE public.worker_job_links (job_id uuid, worker_id uuid, business_id uuid, revoked_at timestamptz, expires_at timestamptz);
  `);
  for (const s of [fn(CORE, "has_role"), fn(CORE, "is_admin"), fn(CORE, "is_job_owner"), fn(P23, "is_business_member"), fn(P115, "job_assignment_role"),
    canAccessFrom === "0147" ? fn(P147, "can_access_job") : fn(P23, "can_access_job"), fn(CORE, "my_job_role")]) await db.exec(s);
  await db.exec(`
    GRANT USAGE ON SCHEMA auth, public TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;
    INSERT INTO public.user_roles VALUES ('${U.office}','admin'), ('${U.ownerA}','owner'), ('${U.ownerB}','owner'), ('${U.installerA}','installer'), ('${U.installerB}','installer'), ('${U.electricianA}','electrician'), ('${U.workerA}','installer');
    INSERT INTO public.owners VALUES ('${OWN.a}','${U.ownerA}'), ('${OWN.b}','${U.ownerB}');
    INSERT INTO public.jobs VALUES ('${JOB.a}','${OWN.a}',null), ('${JOB.b}','${OWN.b}',null), ('${JOB.deleted}','${OWN.a}', now());
    INSERT INTO public.job_assignments VALUES
      ('${JOB.a}','${U.installerA}','${BIZ.instA}','installer',true), ('${JOB.a}','${U.electricianA}','${BIZ.elecA}','electrician',true),
      ('${JOB.b}','${U.installerB}','${BIZ.instB}','installer',true), ('${JOB.deleted}','${U.installerA}','${BIZ.instA}','installer',true);
    INSERT INTO public.business_members VALUES ('${BIZ.instA}','${U.ffsBossA}','business_admin',true), ('${BIZ.instB}','${U.ffsBossB}','business_admin',true), ('${BIZ.instA}','${U.workerA}','member',true),
      ('${BIZ.elecA}','${U.recAdminNoRole}','business_admin',true);
  `);
  const as = async <T,>(uid: string, sql: string, params: unknown[] = []) => db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return (await tx.query<T>(sql, params)).rows;
  });
  const role = async (uid: string, job: string) => (await as<{ r: string | null }>(uid, "SELECT public.my_job_role($1) AS r", [job]))[0]!.r;
  const hasElectrician = async (uid: string) => (await as<{ ok: boolean }>(uid, "SELECT public.has_role($1, 'electrician') AS ok", [uid]))[0]!.ok;
  const access = async (uid: string, job: string) => (await as<{ ok: boolean }>(uid, "SELECT public.can_access_job($1) AS ok", [job]))[0]!.ok;
  return { db, as, role, access, hasElectrician };
}

const db147 = await database("0147");
const db23 = await database("0023");

describe("harness integrity", () => {
  test("functions are the migration statements and run as `authenticated` with the impersonated uid", async () => {
    expect(fn(P115, "job_assignment_role")).toContain("m.member_role = 'business_admin'");
    expect(fn(P147, "can_access_job")).toContain("deleted_at is not null");
    const [r] = await db147.as<{ who: string; me: string }>(U.installerA, "SELECT current_user AS who, auth.uid()::text AS me");
    expect(r).toEqual({ who: "authenticated", me: U.installerA });
  });
});

// my_job_role -> requireJobRole(): the server-side role for every guarded job action.
const ROLE_MATRIX: [keyof typeof U, string | null, string | null][] = [
  ["office", "admin", "admin"],
  ["ownerA", "owner", null],
  ["ownerB", null, "owner"],
  ["installerA", "installer", null],
  ["installerB", null, "installer"],
  ["electricianA", "electrician", null],
  ["ffsBossA", "installer", null],   // FFS = approved partner business admin, no trade role: reaches only its business's assigned job
  ["ffsBossB", null, "installer"],
  ["workerA", null, null],           // business staff not assigned to the job
  ["unapproved", null, null],
];
describe("A4 five roles: my_job_role (requireJobRole) per job", () => {
  for (const [who, a, b] of ROLE_MATRIX) test(`${who}: job A -> ${a ?? "none"}, job B -> ${b ?? "none"}`, async () => {
    expect(await db147.role(U[who], JOB.a)).toBe(a);
    expect(await db147.role(U[who], JOB.b)).toBe(b);
  });
  test("FFS / electrician basic actions (requireJobRole(['electrician','installer'])) admit only the assigned trade side", async () => {
    const tradeAction = async (uid: string, job: string) => ["electrician", "installer"].includes(String(await db147.role(uid, job)));
    expect(await tradeAction(U.ffsBossA, JOB.a)).toBe(true);
    expect(await tradeAction(U.electricianA, JOB.a)).toBe(true);
    expect(await tradeAction(U.ffsBossA, JOB.b)).toBe(false);
    expect(await tradeAction(U.electricianA, JOB.b)).toBe(false);
    expect(await tradeAction(U.ownerA, JOB.a)).toBe(false);
    expect(await tradeAction(U.workerA, JOB.a)).toBe(false);
  });
});

// can_access_job: the RLS boundary (also the first check of the A3 intake-progress gate).
describe("A3 cross-customer / cross-business isolation: can_access_job", () => {
  const ACCESS: [keyof typeof U, boolean, boolean][] = [
    ["office", true, true], ["ownerA", true, false], ["ownerB", false, true], ["installerA", true, false], ["installerB", false, true],
    ["electricianA", true, false], ["ffsBossA", true, false], ["ffsBossB", false, true], ["workerA", false, false], ["unapproved", false, false],
  ];
  for (const [variant, d] of [["0147 (current)", db147], ["0023 (pre soft-delete)", db23]] as const) {
    for (const [who, a, b] of ACCESS) test(`${variant}: ${who} job A=${a}, job B=${b}`, async () => {
      expect(await d.access(U[who], JOB.a)).toBe(a);
      expect(await d.access(U[who], JOB.b)).toBe(b);
    });
  }
  test("0147: a soft-deleted job is closed to its installer, its FFS business admin and its owner; office keeps history", async () => {
    for (const who of ["installerA", "ffsBossA", "ownerA"] as const) expect(await db147.access(U[who], JOB.deleted)).toBe(false);
    expect(await db147.access(U.office, JOB.deleted)).toBe(true);
  });
});

describe("A3 intake-progress gate on the real can_access_job", () => {
  const rpcFor = (uid: string) => async (_fn: string, args: Record<string, unknown>) => ({ data: (await db147.as<{ ok: boolean }>(uid, "SELECT public.can_access_job($1) AS ok", [args._job]))[0]!.ok });
  test("the assigned installer passes; another business's installer, its FFS admin, another customer and an unassigned staff member are refused before the job is read", async () => {
    let reads = 0;
    const loadJob = async () => { reads++; return { channel: "hivic_sourced", originating_installer_business_id: null }; };
    expect(await intakeProgressGate(rpcFor(U.installerA), loadJob, JOB.a)).toEqual({ applies: false });
    expect(reads).toBe(1);
    for (const who of ["installerB", "ffsBossB", "ownerB", "workerA", "unapproved"] as const) {
      await expect(intakeProgressGate(rpcFor(U[who]), loadJob, JOB.a)).rejects.toThrow("Not your job.");
    }
    expect(reads).toBe(1);
  });
});

describe("A4 regulated electrical result: who may record it (requireJobRole + clearance guard)", () => {
  const recorder = async (uid: string, job: string) => clearanceRecorderAllowed({ jobRole: await db147.role(uid, job), hasElectricianRole: await db147.hasElectrician(uid) });
  test("the gap: an electrician business's admin without the electrician role reaches job A as 'electrician' (0115)", async () => {
    expect(await db147.role(U.recAdminNoRole, JOB.a)).toBe("electrician");
    expect(await db147.hasElectrician(U.recAdminNoRole)).toBe(false);
  });
  test("closed: only Office or the licensed electrician on the job may record the PIESA / assessment result", async () => {
    expect(await recorder(U.electricianA, JOB.a)).toBe(true);
    expect(await recorder(U.office, JOB.a)).toBe(true);
    for (const who of ["recAdminNoRole", "ffsBossA", "installerA", "ownerA", "workerA", "unapproved"] as const) expect(await recorder(U[who], JOB.a)).toBe(false);
    expect(await recorder(U.electricianA, JOB.b)).toBe(false); // not their job
  });
});
