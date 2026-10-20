// Ready Check ceiling areas on PGlite through the REAL server code (ready-check-draft.server: loadRcDraft, saveRcAreas,
// startRcCorrection, rcWorksBlockers; prestart.server requirePrestartClear) and the REAL RPC handler guard
// (ready-check-draft.functions saveReadyCheckAreas). Pending migration 0214 is applied from its file to the practice DB.
// Faked boundaries only: installer intake facts (installerIntakeState / isIntakeJob / siteConditionsHoldFor), workflow
// logEvent, auth middleware + the caller's RLS RPCs. No network, no live database, no sends.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key);
CREATE TABLE ready_checks (id uuid primary key default gen_random_uuid(), job_id uuid, version int, status text, installer_user_id uuid, installer_business_id uuid,
  attended_at timestamptz, external_mitti_id text, submitted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), unique (job_id, version));
CREATE TABLE ready_check_observations (id uuid primary key default gen_random_uuid(), ready_check_id uuid, job_id uuid, field_key text, value jsonb, evidence_document_ids uuid[],
  recorded_by uuid, recorded_at timestamptz default now(), unique (ready_check_id, field_key));
CREATE TABLE public.evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, gate text, responsible_role text,
  required boolean, status text, verified_by uuid, verified_at timestamptz, notes text, sort int default 0, constraint evidence_requirements_job_id_category_key unique (job_id, category));
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, removal_required boolean, removal_m2 numeric, supplied_removal_m2 numeric, created_by uuid, created_at timestamptz default now());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, uploaded_by uuid, created_at timestamptz default now());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, assignment_id uuid, created_at timestamptz default now());
CREATE TABLE pre_start_checks (id uuid primary key default gen_random_uuid(), job_id uuid, scheduled_start timestamptz, passed boolean, failures jsonb, checked_at timestamptz default now());`);
await db.exec(readFileSync(new URL("../docs/pending-migrations/0214_evidence_requirement_area_key.sql", import.meta.url), "utf8"));

const shim = postgrestShim(db);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: shim }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError, piesaStatus: async () => null, requireAdmin: async () => {},
  logEvent: async (job: string, _a: unknown, type: string, summary: string, details: unknown) => { await db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,$2,$3,$4)", [job, type, summary, JSON.stringify(details)]); },
}));
type Facts = { attended: "yes" | "no" | null; areaM2: number | null; insulation: "none" | "below_r2" | "unknown" | null; proposedR: number | null; includes: string | null };
const facts = new Map<string, Facts>();
mock.module("../src/lib/installer-intake.server", () => ({
  isIntakeJob: async () => true,
  siteConditionsHoldFor: async () => ({ open: false, note: null }),
  installerIntakeState: async (j: string) => ({ ...facts.get(j)!, areaProvenance: "installer_provisional", coordination: "self_managed", readiness: { ready: false, blockers: [] }, releaseBlockers: [] }),
}));
const rpc = { member: true };
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/piisa-a3.server", () => ({ assignedInstallerBusiness: async () => BIZ }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => { let v: (d: unknown) => unknown = (d) => d; const c = { middleware: () => c, inputValidator: (f: typeof v) => { v = f; return c; },
    handler: (h: (a: unknown) => unknown) => (a: { data: unknown; context: unknown }) => h({ data: v(a.data), context: a.context }) }; return c; },
}));

const S = await import("../src/lib/ready-check-draft.server");
const F = await import("../src/lib/ready-check-draft.functions");
const { requirePrestartClear } = await import("../src/lib/prestart.server");
const { INSTALL_EVIDENCE_CATEGORIES } = await import("../src/lib/prestart.core");
const { RC_ORIGINAL_CONDITION_KEYS, RC_DRAFT_FIELDS } = await import("../src/lib/ready-check-draft.core");

const BIZ = "00000000-0000-4000-8000-0000000000b1", USER = "00000000-0000-4000-8000-0000000000a1", SUPPLIER = "00000000-0000-4000-8000-0000000000a9";
let JOB = "";
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const newJob = async (f: Facts, m?: { removal: boolean; removalM2: number }) => {
  JOB = crypto.randomUUID(); facts.set(JOB, f);
  await q("insert into jobs values ($1)", [JOB]);
  if (m) await q("insert into ceiling_measurements (job_id, is_current, removal_required, supplied_removal_m2, created_by, created_at) values ($1,true,$2,$3,$4,'2026-10-15T01:00:00Z')", [JOB, m.removal, m.removalM2, SUPPLIER]);
  await q("insert into documents (job_id, kind, title, uploaded_by) values ($1,'installer_import','Supporting evidence — roof.jpg',$2)", [JOB, SUPPLIER]);
};
const area = (key: string, label: string, p: Record<string, unknown>) => ({ key, label, areaM2: null, existing: null, rValue: null, removal: null, removalM2: null, product: null, scope: null, sources: {}, ...p }) as never;
const fillOriginalCondition = async () => {
  const [rc] = await q<{ id: string }>("select id from ready_checks where job_id=$1", [JOB]);
  for (const k of RC_ORIGINAL_CONDITION_KEYS) { const f = RC_DRAFT_FIELDS.find((x) => x.key === k)!; const v = f.kind === "enum" ? f.options![0] : f.kind === "boolean" ? true : f.kind === "number" || f.kind === "integer" ? 80 : "x";
    await q("insert into ready_check_observations (ready_check_id, job_id, field_key, value) values ($1,$2,$3,$4) on conflict do nothing", [rc.id, JOB, k, JSON.stringify(v)]); }
};
const setReq = (key: string, cat: string, status: string) => q("update evidence_requirements set status=$1 where job_id=$2 and area_key=$3 and category=$4", [status, JOB, key, cat]);
const ATT: Facts = { attended: "yes", areaM2: 80, insulation: "below_r2", proposedR: 4, includes: "R4.0 batts, whole ceiling" };

beforeEach(() => { rpc.member = true; });

describe("carry-forward", () => {
  test("attended + quoted: saved area/insulation/removal/product/scope suggested with supplier and time; nothing written", async () => {
    await newJob(ATT, { removal: true, removalM2: 30 });
    const d = await S.loadRcDraft(JOB);
    expect(d.areas).toEqual([]); expect(d.areasSaved).toBe(false); expect(d.preliminaryOnly).toBe(false);
    const [a] = d.suggestedAreas;
    expect([a.areaM2, a.existing, a.removal, a.removalM2, a.product, a.scope]).toEqual([80, "present", "yes", 30, "R4", "R4.0 batts, whole ceiling"]);
    expect(a.sources.areaM2).toEqual({ kind: "installer_supplied", by: SUPPLIER, at: "2026-10-15T01:00:00.000Z" });
    expect(d.supportingFiles.map((f) => [f.title, f.accepted])).toEqual([["Supporting evidence — roof.jpg", false]]);
    expect((await q("select * from ready_checks where job_id=$1", [JOB])).length).toBe(0);
  });
  test("attended + unquoted: same carry-forward without a quote scope; unknown insulation stays unknown", async () => {
    await newJob({ ...ATT, includes: null, insulation: "unknown", proposedR: null }, { removal: false, removalM2: 0 });
    const [a] = (await S.loadRcDraft(JOB)).suggestedAreas;
    expect([a.existing, a.removal, a.scope, a.product]).toEqual([null, "no", null, null]);
    expect(a.sources.existing).toBeUndefined();
  });
  test("not attended: estimate never becomes a site observation", async () => {
    await newJob({ ...ATT, attended: "no" }, { removal: true, removalM2: 30 });
    const d = await S.loadRcDraft(JOB);
    expect(d.suggestedAreas).toEqual([]); expect(d.preliminaryOnly).toBe(true);
    const r = await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main ceiling", { areaM2: 80 })]);
    expect(r.areas[0].sources.areaM2?.kind).toBe("recorded_onsite"); // recorded by the person saving it, not "supplied"
  });
  test("unknown attendance: nothing carried forward", async () => {
    await newJob({ ...ATT, attended: null }, { removal: true, removalM2: 30 });
    expect((await S.loadRcDraft(JOB)).suggestedAreas).toEqual([]);
  });
});

describe("two areas, save/reopen, retry", () => {
  test("different removal conditions persist with per-area evidence rows; provenance kept for unchanged facts", async () => {
    await newJob(ATT, { removal: true, removalM2: 30 });
    const [main] = (await S.loadRcDraft(JOB)).suggestedAreas;
    const input = [{ ...main, areaM2: 50, sources: {} }, area("garage", "Garage", { areaM2: 30, existing: "none", removal: "no" })];
    await S.saveRcAreas(JOB, USER, BIZ, input as never);
    await S.saveRcAreas(JOB, USER, BIZ, input as never); // retry / double-click
    const d = await S.loadRcDraft(JOB); // full reopen
    expect(d.areas.map((a) => [a.key, a.areaM2, a.removal, a.removalM2])).toEqual([["main", 50, "yes", 30], ["garage", 30, "no", null]]);
    expect(d.areas[0].sources.removalM2?.kind).toBe("installer_supplied"); // unchanged -> original supplier
    expect(d.areas[0].sources.areaM2).toMatchObject({ kind: "recorded_onsite", by: USER }); // changed -> saver
    expect(d.areaTotals).toEqual({ areaM2: 80, removalM2: 30 });
    expect((await q("select area_key, category from evidence_requirements where job_id=$1 order by area_key, category", [JOB])).map((r) => `${r.area_key}/${r.category}`))
      .toEqual(["garage/before_ceiling_space", "garage/completed_installation", "main/before_ceiling_space", "main/completed_installation"]);
    expect((await q("select * from ready_check_observations where job_id=$1 and field_key='areas.v1'", [JOB])).length).toBe(1);
    expect((await q("select * from ready_checks where job_id=$1", [JOB])).length).toBe(1);
    // job-level rows still unique per job+category
    await q("insert into evidence_requirements (job_id, category, status) values ($1,'before_ceiling_space','outstanding')", [JOB]);
    await expect(q("insert into evidence_requirements (job_id, category, status) values ($1,'before_ceiling_space','outstanding')", [JOB])).rejects.toThrow();
  });
  test("removal over the area and areas not matching the measured total are refused", async () => {
    await newJob(ATT);
    await expect(S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 20, existing: "present", removal: "yes", removalM2: 25 })])).rejects.toThrow(/can't be more than the area/);
    await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 20 })]); await fillOriginalCondition(); // measured total 80
    await expect(S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 20 })])).rejects.toThrow(/add up to 20/);
  });
});

describe("original-condition hold at the works boundary", () => {
  test("missing / uploaded / rejected block; accepted clears only its own area; upload stays possible", async () => {
    await newJob(ATT);
    await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 50, existing: "present", removal: "yes", removalM2: 50 }), area("garage", "Garage", { areaM2: 30, existing: "none", removal: "no" })]);
    await fillOriginalCondition();
    expect(INSTALL_EVIDENCE_CATEGORIES).not.toContain("before_ceiling_space"); // before-work upload is not start-locked
    expect(await S.rcWorksBlockers(JOB)).toEqual(["Main: original-condition evidence photo or video not uploaded", "Garage: original-condition evidence photo or video not uploaded"]);
    await setReq("main", "before_ceiling_space", "uploaded");
    expect((await S.rcWorksBlockers(JOB))[0]).toBe("Main: original-condition evidence uploaded, waiting for office review");
    await setReq("main", "before_ceiling_space", "rejected");
    expect((await S.rcWorksBlockers(JOB))[0]).toBe("Main: original-condition evidence rejected — upload again");
    await expect(requirePrestartClear(JOB)).rejects.toThrow(/Not cleared to start.*Main: original-condition evidence rejected/);
    await setReq("main", "before_ceiling_space", "verified");
    expect(await S.rcWorksBlockers(JOB)).toEqual(["Garage: original-condition evidence photo or video not uploaded"]);
    await setReq("garage", "before_ceiling_space", "verified");
    expect(await S.rcWorksBlockers(JOB)).toEqual([]);
    await requirePrestartClear(JOB); // no booking -> cleared
    const d = await S.loadRcDraft(JOB); // completion evidence is due after work, not a start blocker, and is not "verified" because it exists
    expect(d.areaTasks.map((t) => [t.area, t.due, t.reviewedBy])).toEqual([["Main", "after the work, before office AP review", "Home Insulation Victoria office"], ["Garage", "after the work, before office AP review", "Home Insulation Victoria office"]]);
  });
  test("unknown answers block; read failures fail closed", async () => {
    await newJob(ATT);
    await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 80, existing: "unknown" })]);
    expect(await S.rcWorksBlockers(JOB)).toEqual(expect.arrayContaining(["Main: existing insulation not recorded", "Main: removal not recorded"]));
    await q("update ready_check_observations set value='{\"areas\":\"x\"}' where job_id=$1 and field_key='areas.v1'", [JOB]);
    await expect(S.rcWorksBlockers(JOB)).rejects.toThrow(/could not be read/);
    await expect(S.loadRcDraft(JOB)).rejects.toThrow(/could not be read/);
  });
  test("without migration 0214 the area read fails closed with a clear message", async () => {
    await newJob(ATT);
    await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 80 })]);
    await db.exec("alter table evidence_requirements rename column area_key to area_key_x");
    try { await expect(S.rcWorksBlockers(JOB)).rejects.toThrow(/pending database update \(0214\)/); }
    finally { await db.exec("alter table evidence_requirements rename column area_key_x to area_key"); }
  });
});

describe("submitted Ready Checks are immutable; corrections are dated versions", () => {
  test("correction copies answers into version 2; version 1 rows unchanged; retry does not duplicate", async () => {
    await newJob(ATT);
    await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 80, existing: "none", removal: "no" })]);
    await q("update ready_checks set status='submitted', submitted_at=now() where job_id=$1", [JOB]);
    const before = await q("select field_key, value::text, recorded_by, recorded_at from ready_check_observations o join ready_checks r on r.id=o.ready_check_id where r.version=1 and r.job_id=$1 order by field_key", [JOB]);
    await expect(S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 70 })])).rejects.toThrow(/already submitted/);
    await S.startRcCorrection(JOB, USER, "Garage found on site");
    await S.startRcCorrection(JOB, USER, "Garage found on site"); // retry
    expect((await q("select version, status from ready_checks where job_id=$1 order by version", [JOB])).map((r) => `${r.version}:${r.status}`)).toEqual(["1:submitted", "2:draft"]);
    await S.saveRcAreas(JOB, USER, BIZ, [area("main", "Main", { areaM2: 50, existing: "none", removal: "no" }), area("garage", "Garage", { areaM2: 30, existing: "none", removal: "no" })]);
    const after = await q("select field_key, value::text, recorded_by, recorded_at from ready_check_observations o join ready_checks r on r.id=o.ready_check_id where r.version=1 and r.job_id=$1 order by field_key", [JOB]);
    expect(after).toEqual(before);
    expect((await S.loadRcDraft(JOB)).areas.length).toBe(2);
  });
});

describe("RPC guard", () => {
  test("another business is refused with zero writes", async () => {
    await newJob(ATT);
    rpc.member = false;
    const ctx = { userId: USER, supabase: { rpc: async (fn: string) => ({ data: fn === "is_business_member" ? rpc.member : true, error: null }) } };
    await expect((F.saveReadyCheckAreas as never as (a: unknown) => Promise<unknown>)({ data: { jobId: JOB, areas: [{ key: "main", label: "Main", areaM2: 80, existing: null, rValue: null, removal: null, removalM2: null, product: null, scope: null }] }, context: ctx })).rejects.toThrow(/Only the job's installer business/);
    expect((await q("select * from ready_checks where job_id=$1", [JOB])).length).toBe(0);
    expect((await q("select * from evidence_requirements where job_id=$1", [JOB])).length).toBe(0);
  });
});
