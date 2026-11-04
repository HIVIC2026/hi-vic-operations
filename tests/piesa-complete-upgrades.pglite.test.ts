// Part 3 Task 4b (Jo 4 Nov 2026): Complete PIESA under the new rules, on real rows (PGlite).
// - An "upgrades needed" live A3 completes with no items, no price and no fixes times (electricians quote and book the
//   upgrades with the owner directly).
// - A same-day A3 (q30 Yes + Part C) writes ONE post_rectification pass record on Complete PIESA, so the job moves to
//   installation scheduling and reads "Waiting for certificate" / "certificate in" exactly like the A4 path.
// - Installer's own jobs: the Mitti sync auto-completes a Complete A3 once per form; a refusal is ONE office row.
// The real completePiesaAssessment, applyPiesaRecord, jobCertificateFacts, currentCoes and the auto-complete run here;
// the stage graph, rules notice, official PIESA filing, deposit request, clearance notice and autoAdvance are stubbed at
// their seams (workflow.server's transition moves the stage on the real row).
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL, FIXES_INCLUDED_LABEL, SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } from "../src/lib/fixes-day.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text, job_number text, next_action text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, full_legal_name text, removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, assigned_at timestamptz default clock_timestamp());
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, status text, external_mitti_id text, mitti_raw_snapshot jsonb, completed_at timestamptz, piesa_outcome text, assessed_on text, -- PostgREST returns a date column as "YYYY-MM-DD"
 
  life_support_confirmed boolean, switchboard_condition text, rcds_present boolean, no_rectification_confirmed boolean, assessor_id uuid, mitti_sync_status text);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, assessment_id uuid, kind text, outcome text, completed_date date, signed_off_by uuid, external_mitti_id text, notes text,
  rectification_completed_at timestamptz, section_c_signed_at timestamptz, is_current boolean default true, created_at timestamptz default clock_timestamp());
-- Fix round 3: the live one-current-record-per-job index (drizzle/migrations/0000_hivic_core_schema.sql).
create unique index if not exists piesa_current_uq on piesa_records(job_id) where is_current;
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, gate text, label text, required boolean default false, status text default 'outstanding');
CREATE TABLE evidence_files (id uuid primary key default gen_random_uuid(), requirement_id uuid, job_id uuid, storage_path text, mime_type text, uploaded_at timestamptz default clock_timestamp());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, mime_type text, external_id text, source_system text, created_at timestamptz default clock_timestamp());
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, description text, status text, needs_office_pricing boolean default false);
CREATE TABLE compliance_checks (id uuid primary key default gen_random_uuid(), job_id uuid, check_key text, status text, checked_at timestamptz);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), U_ELEC = id(11), U_OFFICE = id(12);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test','0300000000'), ($2,'Sparky Co','Sparky Co',null,'0411111111')`, [INST, ELEC]);
await db.query(`insert into partner_workers (business_id, profile_id, full_legal_name) values ($1,$2,'Sparky Sam')`, [ELEC, U_ELEC]);

const label = (fid: string) => SHORT_PIESA_FIELDS.find((f) => f.id === fid)!.label;
const geo = (m: string) => ({ mediaId: m, capturedAt: "2026-11-03T01:00:00.000Z", lat: -37.9, lng: 145.1 });
type Snap = { upgrades: "Yes" | "No"; today?: "Yes" | "No"; certNow?: "Yes" | "No"; certDate?: string; ces?: string[]; price?: string };
const snapshot = (o: Snap) => [
  { label: A3_REPAIR_NEEDED_LABEL, value: o.upgrades },
  ...(o.today ? [{ label: A3_UPGRADES_TODAY_LABEL, value: o.today }] : []),
  ...(o.certNow ? [{ label: CERTIFICATE_NOW_LABEL, value: o.certNow }] : []),
  ...(o.certDate ? [{ label: label("certDate"), value: o.certDate }] : []),
  ...(o.price ? [{ label: label("fixesPriceIncGst"), value: o.price }, { label: FIXES_INCLUDED_LABEL, value: "Replace the split conduit" }] : []),
  { label: PIESA_EVIDENCE_BY_ID.switchboard_photo.label, value: null, media: [geo("sb1")] },
  { label: PIESA_EVIDENCE_BY_ID.onsite_photo.label, value: null, media: [geo("os1")] },
  ...(o.ces ? [{ label: PIESA_EVIDENCE_BY_ID.ces_file.label, value: null, media: o.ces.map((m) => ({ mediaId: m, capturedAt: null, lat: null, lng: null })) }] : []),
];
let n = 300;
async function seedJob(o: { snap: Snap; channel?: string; stage?: string; assessedOn?: string | null; item?: { description: string; needsPricing?: boolean } }) {
  const j = id(++n);
  await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source, job_number) values ($1,$2,$3,$4,'qa_test',$5)", [j, o.stage ?? "piesa_scheduled", INST, o.channel ?? "installer_sourced", `HV-${n}`]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U_ELEC]);
  await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'assessment','confirmed','2026-11-03T00:00:00Z')", [j]);
  await db.query(`insert into assessments (job_id, status, external_mitti_id, mitti_raw_snapshot, piesa_outcome, assessed_on, life_support_confirmed, mitti_sync_status)
    values ($1,'draft',$2,$3,$4,$5,false,'synced')`, [j, `audit-${n}`, JSON.stringify(snapshot(o.snap)), o.snap.upgrades === "Yes" ? "fail" : "pass", o.assessedOn === undefined ? "2026-11-03" : o.assessedOn]);
  await db.query("insert into compliance_checks (job_id, check_key, status) values ($1,'rectification','pending'), ($1,'electrical_assessment','pending')", [j]);
  if (o.item) await db.query("insert into rectification_items (job_id, description, status, needs_office_pricing) values ($1,$2,'required',$3)", [j, o.item.description, !!o.item.needsPricing]);
  return { j, auditId: `audit-${n}` };
}

const admin = postgrestShim(db);
// Fix round 1: database faults a test can switch on — the same-day record insert, or the earlier-records count read.
const faults = { postInsert: null as string | null, priorRead: false };
const failing = (message: string) => {
  const r = { data: null, count: null, error: { message } };
  const p: unknown = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res(r) : () => p) });
  return p;
};
const realFrom = admin.from.bind(admin);
(admin as { from: (t: string) => unknown }).from = (t: string) => {
  const b = realFrom(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
  if (t === "piesa_records") {
    const ins = b["insert"]!.bind(b), sel = b["select"]!.bind(b);
    b["insert"] = (row: unknown) => (faults.postInsert && (row as { kind?: string })?.kind === "post_rectification" ? failing(faults.postInsert) : ins(row));
    b["select"] = (cols: unknown, o: unknown) => (faults.priorRead && (o as { head?: boolean } | undefined)?.head ? failing("read timeout") : sel(cols, o));
  }
  return b;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
const realWorkflow = await import("../src/lib/workflow.server");
const stageOf = async (job: string) => (await db.query<{ stage: string }>("select stage from jobs where id=$1", [job])).rows[0]!.stage;
const logEvent = async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
  await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]);
};
// A stage guard a test can switch on (the refused auto-complete).
let entryBlock: string | null = null;
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  getStage: stageOf,
  logEvent,
  stageEntryBlockers: async (_j: string, to: string) => (entryBlock && to === "piesa_complete" ? [entryBlock] : []),
  transition: async (job: string, to: string, actor: string | null, summary: string) => {
    const from = await stageOf(job);
    await db.query("update jobs set stage=$2 where id=$1", [job, to]);
    await logEvent(job, actor, "stage_changed", summary, { from, to });
  },
}));
mock.module("../src/lib/requirements.server", () => ({ jobScope: async () => ({ scope: "piesa", label: "PIESA" }), advanceSiteRequirements: async () => ({ advanced: false, scope: "piesa" }) }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null }));
mock.module("../src/lib/piesa-rules-notice.server", () => ({ piesaRulesBlockerFor: async () => null, recheckPiesaRules: async () => undefined }));
mock.module("../src/lib/official-piesa-issue.server", () => ({ issueOfficialPiesa: async () => ({ status: "held" }) }));
const depositCalls: string[] = [];
mock.module("../src/lib/deposit-request.server", () => ({ requestInstallDeposit: async (job: string) => { depositCalls.push(job); return "mocked"; } }));
mock.module("../src/lib/install-clearance.server", () => ({ notifyInstallerClearance: async () => "mocked" }));
mock.module("../src/lib/in-house-forms.server", () => ({ closeUnneededForms: async () => undefined }));
mock.module("../src/lib/in-house-rectification.server", () => ({ optionalPartnerBilledRectificationFor: async () => false }));
// Fix round 2: a reopen a test can switch on (the safety check no longer counts).
const supersededJobs = new Set<string>();
mock.module("../src/lib/repeat-piesa.server", () => ({ currentPiesaSupersededByReopen: async (job: string) => supersededJobs.has(job) }));
const realFixes = await import("../src/lib/fixes-day.server");
mock.module("../src/lib/fixes-day.server", () => ({ ...realFixes, closeUnusedRectificationForm: async () => undefined }));
const inHouseJobs = new Set<string>();
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({ ...realSuppression, inHouseDispatchSkip: async (job: string) => (inHouseJobs.has(job) ? "in_house" : null), readInHouseDispatchState: async (ids: string[]) => ({ failed: false, held: new Set(ids.filter((j) => inHouseJobs.has(j))) }) }));

const { completePiesaAssessment } = await import("../src/lib/piesa-complete.server");
const cls = await import("../src/lib/certificate-later.server");
const auto = await import("../src/lib/piesa-auto-complete.server");
const ownCore = await import("../src/lib/own-job-piesa.core");
const needsCore = await import("../src/lib/office-needs.core");
const pc = await import("../src/lib/piesa-complete.server");
const sameDay = await import("../src/lib/same-day-part-c.core");

const records = async (j: string, kind?: string) => (await db.query<{ kind: string; outcome: string; completed_date: string; section_c_signed_at: string | null; signed_off_by: string | null; is_current: boolean }>(
  `select kind, outcome, completed_date::text, section_c_signed_at::text, signed_off_by, is_current from piesa_records where job_id=$1 ${kind ? "and kind=$2" : ""} order by created_at`, kind ? [j, kind] : [j])).rows;
const events = async (j: string, type: string) => (await db.query<{ details: Record<string, unknown>; summary: string }>("select details, summary from workflow_events where job_id=$1 and event_type=$2 order by created_at", [j, type])).rows;
const run = async (j: string, user = U_OFFICE) => { try { await completePiesaAssessment({ jobId: j }, user); return ""; } catch (e) { return (e as Error).message; } };

describe("Complete PIESA — upgrades needed, electrician quotes the owner directly", () => {
  test("(a) live A3, upgrades needed, not today, no items / price / times → completes, outcome fail, PIESA complete", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    expect(await run(j)).toBe("");
    expect(await stageOf(j)).toBe("piesa_complete");
    expect(await records(j)).toMatchObject([{ kind: "initial", outcome: "fail" }]);
    // Part 4 fix wave C1 (Jo 2 Nov 2026, answer 21): the 10% deposit is asked on ANY recorded PIESA result — upgrades to come included.
    expect(depositCalls).toContain(j);
    // No fixes times were asked or written.
    expect(await events(j, "rectification_windows_given")).toHaveLength(0);
  });

  test("(a) items the A3 listed (even unpriced 'other' items) stay listed and no longer block", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "No" }, item: { description: "Other: odd junction box", needsPricing: true } });
    expect(await run(j)).toBe("");
    expect(await stageOf(j)).toBe("piesa_complete");
    expect((await db.query("select status from rectification_items where job_id=$1", [j])).rows).toEqual([{ status: "required" }]);
  });

  test("(b) same-day A3 without the certificate → one post_rectification pass record, items done, installation scheduling, waiting for certificate", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" }, item: { description: "Replace split conduit" } });
    expect(await run(j)).toBe("");
    const post = await records(j, "post_rectification");
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({ outcome: "pass", completed_date: "2026-11-03", is_current: true, signed_off_by: U_OFFICE });
    expect(post[0]!.section_c_signed_at).toMatch(/^2026-11-03/);
    expect((await records(j, "initial"))).toMatchObject([{ outcome: "fail", is_current: false }]);
    expect((await db.query("select status from rectification_items where job_id=$1", [j])).rows).toEqual([{ status: "completed" }]);
    expect((await db.query("select status from compliance_checks where job_id=$1", [j])).rows).toEqual([{ status: "pass" }, { status: "pass" }]);
    expect(await stageOf(j)).toBe("installation_scheduling");
    // Asked at the PIESA result (Part 4 C1) and again by the Part C record path; requestInstallDeposit is idempotent per job.
    expect(depositCalls.filter((x) => x === j).length).toBeGreaterThanOrEqual(1);
    const f = await cls.jobCertificateFacts(j);
    expect(f).toMatchObject({ partCRecorded: true, upgradesDoneAt: "2026-11-03", state: "waiting_for_certificate" });
    expect(await events(j, "piesa_recorded")).toMatchObject([{ details: { source: "mitti_a3_same_day", audit_id: expect.stringMatching(/^audit-/) } }]);
    // A second Complete PIESA is refused (already complete) and writes nothing.
    expect(await run(j)).toMatch(/already complete/);
    expect(await records(j, "post_rectification")).toHaveLength(1);
  });

  test("(b) the Part C date is the certificate date on the answers when given", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No", certDate: "2026-11-02" }, assessedOn: "2026-11-01" });
    expect(await run(j)).toBe("");
    expect(await records(j, "post_rectification")).toMatchObject([{ completed_date: "2026-11-02" }]);
  });

  test("(b) a repeated same-day record for the same form writes no second record (re-sync / retry)", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    expect(await run(j)).toBe("");
    const { applyPiesaRecord } = await import("../src/lib/piesa-record.server");
    await applyPiesaRecord({ jobId: j, actorId: null, kind: "post_rectification", outcome: "pass", completedDate: "2026-11-03", sectionCSignedDate: "2026-11-03", source: { kind: "mitti_a3_same_day", auditId } });
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await events(j, "piesa_recorded")).toHaveLength(1);
    expect(await stageOf(j)).toBe("installation_scheduling");
  });

  test("(c) same-day A3 with the certificate attached (q45) → certificate in", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "Yes", ces: ["ces1"] } });
    await db.query("insert into documents (job_id, kind, title, storage_path, mime_type, external_id, source_system) values ($1,$2,$3,'jobs/x/ces1.pdf','application/pdf','audit:ces1','mitti')", [j, FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE]);
    expect(await run(j)).toBe("");
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await stageOf(j)).toBe("installation_scheduling");
    expect((await cls.jobCertificateFacts(j)).state).toBe("certificate_in");
  });

  test("(f) legacy A3 with a price still completes as before (no Part C record)", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", price: "450" } });
    expect(await run(j)).toBe("");
    expect(await stageOf(j)).toBe("piesa_complete");
    expect(await records(j)).toMatchObject([{ kind: "initial", outcome: "fail" }]);
    expect(await records(j, "post_rectification")).toHaveLength(0);
  });

  test("an old (non-live) form still needs the items or the tick", async () => {
    const j = id(++n);
    await db.query("insert into jobs (id, stage, channel, source) values ($1,'piesa_scheduled','hivic_sourced','qa_test')", [j]);
    await db.query("insert into assessments (job_id, status, external_mitti_id, mitti_raw_snapshot, piesa_outcome, assessed_on, life_support_confirmed, switchboard_condition, rcds_present) values ($1,'draft',null,'[]','fail','2026-11-03',false,'ok',true)", [j]);
    expect(await run(j)).toMatch(/No electrical fixes required/);
  });
});

describe("Installer's own job: the Mitti sync completes the PIESA itself", () => {
  test("(d) a Complete A3 at PIESA booked auto-completes once, signed off by the electrician", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("completed");
    expect(await stageOf(j)).toBe("installation_scheduling");
    expect(await records(j, "initial")).toMatchObject([{ signed_off_by: U_ELEC }]);
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await events(j, ownCore.PIESA_AUTO_COMPLETED_EVENT)).toHaveLength(1);
    // A re-sync of the same form does nothing (the PIESA is no longer at booked).
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("not_due");
    expect(await records(j)).toHaveLength(2);
  });

  test("(d) a refused auto-complete leaves ONE office row and the stage unchanged", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    entryBlock = "Owner paperwork not signed";
    try {
      expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("held");
      expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("already");
    } finally { entryBlock = null; }
    expect(await stageOf(j)).toBe("piesa_scheduled");
    const held = await events(j, auto.PIESA_AUTO_COMPLETE_HELD);
    expect(held).toHaveLength(1);
    const reason = String(held[0]!.details["reason"]);
    expect(reason).toBe("PIESA cannot be completed yet: Owner paperwork not signed");
    expect(held[0]!.details).toMatchObject({ audit_id: auditId, needs_office: true });
    expect(await records(j)).toHaveLength(0);
    // The office row says what happened, plainly, with Open job.
    // Join ruling 3: ONE office row kind for every automatic completion (piesa_auto_complete_held, J4 G1 wording).
    const rows = needsCore.needsCandidates({ jobId: j, jobNumber: "HV-1", piesaAutoCompleteHeld: { at: "2026-11-04T00:00:00.000Z", reason } } as never, Date.now());
    expect(rows.find((r) => r.kind === "piesa_auto_complete_held")).toMatchObject({ line: expect.stringMatching(/^Safety check \(PIESA\) not completed by itself: PIESA cannot be completed yet: Owner paperwork not signed/), button: { label: "Open job" } });
  });

  test("(e) an HIV lead is not auto-completed (the electrician or office presses Complete PIESA)", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "No" }, channel: "hivic_sourced" });
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("not_applicable");
    expect(await stageOf(j)).toBe("piesa_scheduled");
    expect(await events(j, ownCore.PIESA_AUTO_COMPLETED_EVENT)).toHaveLength(0);
  });

  test("(e) an in-house partner job IS auto-completed too (join ruling 3: one path for in-house and own jobs); an unsigned A3 is held with the signature line", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "No" } });
    inHouseJobs.add(j);
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: false, auditId, modifiedAt: "m0" })).outcome).toBe("held");
    expect((await events(j, auto.PIESA_AUTO_COMPLETE_HELD))[0]!.details["reason"]).toBe(auto.PIESA_AUTO_SIGNATURE_MISSING);
    expect(await stageOf(j)).toBe("piesa_scheduled");
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId, modifiedAt: "m1" })).outcome).toBe("completed");
    expect(await stageOf(j)).toBe("piesa_complete");
  });

  test("not at PIESA booked → nothing claimed", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "No" }, stage: "piesa_and_install_window_pending" });
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("not_due");
    expect(await events(j, ownCore.PIESA_AUTO_COMPLETED_EVENT)).toHaveLength(0);
  });

  test("wiring: the A3 sync calls the auto-complete on a Complete form only; the office reads the held row", () => {
    const sync = readFileSync("src/lib/mitti.server.ts", "utf8");
    expect(sync).toMatch(/if \(completed && a\.status !== "complete"\) \{\s*try \{ await \(await import\("\.\/piesa-auto-complete\.server"\)\)\.autoCompletePiesa\(jobId, actorId, \{ completed, signed: a3Signed, auditId: a\.external_mitti_id, modifiedAt: plan\.modifiedAt \?\? null \}\)/);
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(needs).toContain("piesaAutoCompleteHeld");
    expect(needs).not.toContain("ownJobPiesaCompleteHeldOpen");
    // Join: the own-job (Part 2) link page is own-job-electrician-link.server; the electrician's live page is Part 6's.
    const link = readFileSync("src/lib/own-job-electrician-link.server.ts", "utf8");
    expect(link).toContain("piesaDone: piesaDoneAtStage(stage)");
  });
});

describe("Fix round 1", () => {
  test("1. the held row is internal (never on the no-login worker job link)", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    entryBlock = "Owner paperwork not signed";
    try { expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "m1" })).outcome).toBe("held"); } finally { entryBlock = null; }
    const rows = (await db.query<{ internal: boolean }>("select internal from workflow_events where job_id=$1 and event_type=$2", [j, auto.PIESA_AUTO_COMPLETE_HELD])).rows;
    expect(rows).toEqual([{ internal: true }]);
    // The office Needs read does not filter on internal, so the row still shows there.
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    const read = needs.slice(needs.indexOf("piesaAutoCompleteHeld"), needs.indexOf("piesaAutoCompleteHeld") + 400);
    expect(read).not.toContain('"internal"');
  });

  test("2. a database error on the same-day record → PIESA complete stands, next step set, ONE office row; a retry writes it once", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" }, item: { description: "Replace split conduit" } });
    faults.postInsert = "database timeout";
    try {
      expect(await run(j)).toBe("");
      // A retry that fails again adds no second office row.
      expect(await pc.retrySameDayPartC(j, null)).toBe("failed");
    } finally { faults.postInsert = null; }
    expect((await db.query("select status from assessments where job_id=$1", [j])).rows).toEqual([{ status: "complete" }]);
    expect(await stageOf(j)).toBe("piesa_complete");
    expect((await db.query("select next_action from jobs where id=$1", [j])).rows).toEqual([{ next_action: "Same-day Part C record failed — database timeout" }]);
    const failed = (await db.query<{ internal: boolean; details: Record<string, unknown> }>("select internal, details from workflow_events where job_id=$1 and event_type=$2", [j, sameDay.SAME_DAY_PART_C_FAILED_EVENT])).rows;
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ internal: true, details: { audit_id: auditId, reason: "database timeout", needs_office: true } });
    expect(await records(j, "post_rectification")).toHaveLength(0);
    // Fix round 3: clear-then-insert (piesa_current_uq allows one current record per job), so the earlier record is no
    // longer current when the insert fails; the retry below writes the missing record.
    expect(await records(j, "initial")).toMatchObject([{ is_current: false }]);
    // The office sees it.
    const evRows = async () => (await db.query<{ event_type: string; created_at: string; details: Record<string, unknown> }>("select event_type, created_at::text, details from workflow_events where job_id=$1 and event_type = any($2)", [j, [sameDay.SAME_DAY_PART_C_FAILED_EVENT, sameDay.SAME_DAY_PART_C_RECOVERED_EVENT]])).rows;
    const open = sameDay.sameDayPartCFailedOpen(await evRows(), { stage: "piesa_complete", postRecord: false });
    expect(open).toMatchObject({ reason: "database timeout" });
    const rows = needsCore.needsCandidates({ jobId: j, jobNumber: "HV-1", sameDayPartCFailed: open } as never, Date.now());
    expect(rows.find((r) => r.kind === "same_day_part_c_failed")).toMatchObject({ line: "Same-day Part C record failed — database timeout. The portal retries it each tick.", button: { label: "Open job" } });
    // A later sync writes the missing record once and the job moves on.
    expect(await pc.retrySameDayPartC(j, null)).toBe("recorded");
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await stageOf(j)).toBe("installation_scheduling");
    expect((await db.query("select status from rectification_items where job_id=$1", [j])).rows).toEqual([{ status: "completed" }]);
    expect((await db.query<{ next_action: string | null }>("select next_action from jobs where id=$1", [j])).rows[0]!.next_action).toBeNull();
    expect(sameDay.sameDayPartCFailedOpen(await evRows(), { stage: "piesa_complete", postRecord: false })).toBeNull();
    expect(await pc.retrySameDayPartC(j, null)).toBe("none");
    expect(await records(j, "post_rectification")).toHaveLength(1);
  });

  test("2. the office Complete PIESA press also writes a missing same-day record", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    faults.postInsert = "database timeout";
    try { expect(await run(j)).toBe(""); } finally { faults.postInsert = null; }
    expect(await records(j, "post_rectification")).toHaveLength(0);
    expect(await run(j)).toBe("");
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await stageOf(j)).toBe("installation_scheduling");
    expect(await run(j)).toMatch(/already complete/);
  });

  test("2. nothing to retry: not a same-day form, or the record is already there", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    expect(await run(j)).toBe("");
    expect(await pc.retrySameDayPartC(j, null)).toBe("none");
    const b = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    expect(await run(b.j)).toBe("");
    expect(await pc.retrySameDayPartC(b.j, null)).toBe("none");
    expect(await records(b.j, "post_rectification")).toHaveLength(1);
  });

  test("2. wiring: a sync of a completed assessment retries the missing same-day record", () => {
    const sync = readFileSync("src/lib/mitti.server.ts", "utf8");
    expect(sync).toMatch(/if \(a\.status === "complete"\) \{\s*locked = true;\s*await \(await import\("\.\/piesa-complete\.server"\)\)\.retrySameDayPartC\(jobId, actorId\)/);
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(needs).toContain("sameDayPartCFailedOpen");
  });

  test("3. a refusal is retried when the form is edited (new modified time), never on an unchanged re-sync", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    entryBlock = "Owner paperwork not signed";
    try {
      expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("held");
      expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T01:00:00Z" })).outcome).toBe("already");
      entryBlock = "Owner paperwork still not signed";
      expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T02:00:00Z" })).outcome).toBe("held");
      expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T02:00:00Z" })).outcome).toBe("already");
    } finally { entryBlock = null; }
    const held = (await db.query<{ event_type: string; created_at: string; details: Record<string, unknown> }>("select event_type, created_at::text, details from workflow_events where job_id=$1 and event_type=$2", [j, auto.PIESA_AUTO_COMPLETE_HELD])).rows;
    expect(held).toHaveLength(2);
    // One office row: the newest reason.
    expect(held.at(-1)!.details["reason"]).toBe("PIESA cannot be completed yet: Owner paperwork still not signed");
    expect((await auto.autoCompletePiesa(j, null, { completed: true, signed: true, auditId: auditId, modifiedAt: "2026-11-04T03:00:00Z" })).outcome).toBe("completed");
    expect(await stageOf(j)).toBe("piesa_complete");
  });

  test("4. an unreadable earlier-records read leaves the assessment incomplete and retryable", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    faults.priorRead = true;
    try { expect(await run(j)).toMatch(/earlier PIESA records could not be read/); } finally { faults.priorRead = false; }
    expect((await db.query("select status from assessments where job_id=$1", [j])).rows).toEqual([{ status: "draft" }]);
    expect(await stageOf(j)).toBe("piesa_scheduled");
    expect(await records(j)).toHaveLength(0);
    expect(await run(j)).toBe("");
    expect(await stageOf(j)).toBe("piesa_complete");
  });

  test("5. the sync header names its two exceptions", () => {
    const head = readFileSync("src/lib/mitti.server.ts", "utf8").split("\n").slice(0, 8).join("\n");
    expect(head).toMatch(/A4/);
    expect(head).toMatch(/post_rectification/);
    expect(head).toMatch(/own job/i);
    expect(head).toMatch(/Complete PIESA/);
  });

  test("6. a certificate date before the safety check date uses the safety check date", () => {
    expect(pc.partCDate({ certDate: "2026-10-30" }, "2026-11-01")).toBe("2026-11-01");
    expect(pc.partCDate({ certDate: "2026-11-02" }, "2026-11-01")).toBe("2026-11-02");
    expect(pc.partCDate({ certDate: "2026-11-01" }, "2026-11-01")).toBe("2026-11-01");
    expect(pc.partCDate({}, "2026-11-01")).toBe("2026-11-01");
  });
});

// Part C recorded another way (the portal page / an A4), the way the live write does it: clear the current record, then insert.
const recordByHand = async (j: string) => {
  await db.query("update piesa_records set is_current=false where job_id=$1 and is_current", [j]);
  await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, is_current) values ($1,'post_rectification','pass','2026-11-03',true)", [j]);
};

describe("Fix round 2 — the same-day record is retried from the tick; the row closes itself", () => {
  const evRows = async (j: string) => (await db.query<{ event_type: string; created_at: string; details: Record<string, unknown> }>("select event_type, created_at::text, details from workflow_events where job_id=$1 and event_type = any($2)", [j, [sameDay.SAME_DAY_PART_C_FAILED_EVENT, sameDay.SAME_DAY_PART_C_RECOVERED_EVENT]])).rows;
  const failedSameDay = async () => {
    const s = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    faults.postInsert = "database timeout";
    try { expect(await run(s.j)).toBe(""); } finally { faults.postInsert = null; }
    expect(await events(s.j, sameDay.SAME_DAY_PART_C_FAILED_EVENT)).toHaveLength(1);
    return s;
  };

  test("1. the tick retries an open failure and writes the record once", async () => {
    const { j } = await failedSameDay();
    const out = await pc.sweepSameDayPartCRetries(new Date());
    expect(out.recorded).toBeGreaterThanOrEqual(1);
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await stageOf(j)).toBe("installation_scheduling");
    expect(await events(j, sameDay.SAME_DAY_PART_C_RECOVERED_EVENT)).toHaveLength(1);
    // A second tick finds nothing open for this job.
    await pc.sweepSameDayPartCRetries(new Date());
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await events(j, sameDay.SAME_DAY_PART_C_RECOVERED_EVENT)).toHaveLength(1);
  });

  test("1. one job's error never stops the sweep, and the sweep never throws", async () => {
    const a = await failedSameDay();
    const b = await failedSameDay();
    faults.postInsert = "still down";
    let out: Awaited<ReturnType<typeof pc.sweepSameDayPartCRetries>>;
    try { out = await pc.sweepSameDayPartCRetries(new Date()); } finally { faults.postInsert = null; }
    expect(out.failed).toBeGreaterThanOrEqual(2);
    expect(await records(a.j, "post_rectification")).toHaveLength(0);
    expect(await records(b.j, "post_rectification")).toHaveLength(0);
    await pc.sweepSameDayPartCRetries(new Date());
    expect(await records(a.j, "post_rectification")).toHaveLength(1);
    expect(await records(b.j, "post_rectification")).toHaveLength(1);
  });

  test("2. no backfill: a same-day A3 with no failure row and no record is left alone", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    expect(await run(j)).toBe("");
    // Like a job completed before 4b: the record and its event are not there, and no failure was logged.
    await db.query("delete from piesa_records where job_id=$1 and kind='post_rectification'", [j]);
    await db.query("delete from workflow_events where job_id=$1 and event_type='piesa_recorded'", [j]);
    await db.query("update jobs set stage='piesa_complete' where id=$1", [j]);
    expect(await pc.retrySameDayPartC(j, null)).toBe("none");
    await pc.sweepSameDayPartCRetries(new Date());
    expect(await records(j, "post_rectification")).toHaveLength(0);
    expect(await stageOf(j)).toBe("piesa_complete");
  });

  test("3. a safety check superseded by a reopen → the row closes with the reason and nothing is written", async () => {
    const { j } = await failedSameDay();
    supersededJobs.add(j);
    try { expect(await pc.retrySameDayPartC(j, null)).toBe("superseded"); } finally { supersededJobs.delete(j); }
    expect(await records(j, "post_rectification")).toHaveLength(0);
    expect(await stageOf(j)).toBe("piesa_complete");
    const rec = await events(j, sameDay.SAME_DAY_PART_C_RECOVERED_EVENT);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.details).toMatchObject({ reason: "safety check superseded by a reopen" });
    expect(sameDay.sameDayPartCFailedOpen(await evRows(j), { stage: "piesa_complete", postRecord: false })).toBeNull();
    // The tick doesn't come back to it.
    await pc.sweepSameDayPartCRetries(new Date());
    expect(await records(j, "post_rectification")).toHaveLength(0);
  });

  test("4. the row closes when Part C is recorded another way, or the job has moved past the retry stages", async () => {
    const F = sameDay.SAME_DAY_PART_C_FAILED_EVENT, R = sameDay.SAME_DAY_PART_C_RECOVERED_EVENT;
    const failed = [{ event_type: F, created_at: "2026-11-04T01:00:00Z", details: { reason: "x" } }];
    expect(sameDay.sameDayPartCFailedOpen(failed, { stage: "piesa_complete", postRecord: false })).toMatchObject({ reason: "x" });
    expect(sameDay.sameDayPartCFailedOpen(failed, { stage: "piesa_complete", postRecord: true })).toBeNull();
    expect(sameDay.sameDayPartCFailedOpen(failed, { stage: "installation_scheduling", postRecord: false })).toBeNull();
    // The recovered event still closes it; a tie goes to the failure.
    expect(sameDay.sameDayPartCFailedOpen([...failed, { event_type: R, created_at: "2026-11-04T02:00:00Z" }], { stage: "piesa_complete", postRecord: false })).toBeNull();
    expect(sameDay.sameDayPartCFailedOpen([{ event_type: R, created_at: "2026-11-04T01:00:00Z" }, ...failed], { stage: "piesa_complete", postRecord: false })).toMatchObject({ reason: "x" });
    // On real rows: Part C recorded by hand → the retry writes nothing more (fix 3: and closes the row, see below).
    const { j } = await failedSameDay();
    await recordByHand(j);
    expect(await pc.retrySameDayPartC(j, null)).toBe("closed");
    expect(await records(j, "post_rectification")).toHaveLength(1);
  });

  test("wiring: the tick runs the sweep; the office read passes the stage and the Part C record", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toMatch(/const \{ sweepSameDayPartCRetries \} = await import\("@\/lib\/piesa-complete\.server"\);\s*\(out as Record<string, unknown>\)\['sameDayPartC'\] = await timed\("sweepSameDayPartCRetries", \(\) => sweepSameDayPartCRetries\(\)\);/);
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    const read = needs.slice(needs.indexOf("same-day Part C record failures"), needs.indexOf("same-day Part C record failures") + 1600);
    expect(read).toMatch(/sameDayPartCFailedOpen\([\s\S]*stage[\s\S]*postRecord/);
    expect(read).toContain("post_rectification");
  });

  test("5. wording: the portal retries it each tick (never 'a later sync')", () => {
    for (const f of ["src/lib/same-day-part-c.core.ts", "src/lib/office-needs.core.ts", "src/lib/piesa-complete.server.ts", "src/lib/office-needs.server.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/later sync/);
    }
    expect(readFileSync("src/lib/same-day-part-c.core.ts", "utf8")).toContain("the portal retries it each tick");
  });
});

describe("Fix round 3 — clear-then-insert for PIESA records; retries that can't succeed close their row", () => {
  const recovered = async (j: string) => events(j, sameDay.SAME_DAY_PART_C_RECOVERED_EVENT);
  const failedSameDay = async () => {
    const s = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No" } });
    faults.postInsert = "database timeout";
    try { expect(await run(s.j)).toBe(""); } finally { faults.postInsert = null; }
    expect(await events(s.j, sameDay.SAME_DAY_PART_C_FAILED_EVENT)).toHaveLength(1);
    return s;
  };

  test("Critical: a post_rectification record on a job with a current initial record is written (piesa_current_uq present)", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "No" }, item: { description: "Replace split conduit" } });
    await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, is_current) values ($1,'initial','fail','2026-11-01',true)", [j]);
    const { applyPiesaRecord } = await import("../src/lib/piesa-record.server");
    const out = await applyPiesaRecord({ jobId: j, actorId: U_OFFICE, kind: "post_rectification", outcome: "pass", completedDate: "2026-11-03", sectionCSignedDate: "2026-11-03", source: { kind: "portal" } });
    expect(out.recordId).toBeTruthy();
    expect(await records(j)).toMatchObject([{ kind: "initial", is_current: false }, { kind: "post_rectification", outcome: "pass", is_current: true }]);
    expect((await db.query("select status from rectification_items where job_id=$1", [j])).rows).toEqual([{ status: "completed" }]);
  });

  test("Critical: the write clears the current record before the insert, with the index named at the insert", () => {
    const src = readFileSync("src/lib/piesa-record.server.ts", "utf8");
    const body = src.slice(src.indexOf("export async function applyPiesaRecord"));
    const items = body.indexOf('admin.from("rectification_items").update({ status: "completed" })');
    const clear = body.indexOf('admin.from("piesa_records").update({ is_current: false }).eq("job_id", r.jobId).eq("is_current", true);');
    const insert = body.indexOf('admin.from("piesa_records").insert(');
    expect(items).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(items);
    expect(insert).toBeGreaterThan(clear);
    expect(body).not.toContain('.neq("id", rec.id)');
    expect(body).toContain("clear the current record first — `piesa_current_uq` (one current record per job)");
  });

  test("Minor 2a: Part C recorded another way while still in a retry stage → the row closes and the tick stops picking it", async () => {
    const { j, auditId } = await failedSameDay();
    await recordByHand(j);
    expect(await stageOf(j)).toBe("piesa_complete");
    expect(await pc.retrySameDayPartC(j, null)).toBe("closed");
    expect(await recovered(j)).toMatchObject([{ details: { audit_id: auditId, reason: "Part C recorded another way" } }]);
    const out = await pc.sweepSameDayPartCRetries(new Date());
    expect(await recovered(j)).toHaveLength(1);
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(out.closed).toBe(0);
  });

  test("Minor 2b: the open failure is for an older form (a new audit is stored) → closed as 'form superseded', nothing written", async () => {
    const { j, auditId } = await failedSameDay();
    await db.query("update assessments set external_mitti_id='audit-newer' where job_id=$1", [j]);
    expect(await pc.retrySameDayPartC(j, null)).toBe("closed");
    expect(await recovered(j)).toMatchObject([{ details: { audit_id: auditId, reason: "form superseded" } }]);
    await pc.sweepSameDayPartCRetries(new Date());
    expect(await recovered(j)).toHaveLength(1);
    expect(await records(j, "post_rectification")).toHaveLength(0);
    expect(await stageOf(j)).toBe("piesa_complete");
  });

  test("Minor 2b: the stored A3 is no longer a same-day form → closed as 'form superseded', nothing written", async () => {
    const { j, auditId } = await failedSameDay();
    await db.query("update assessments set mitti_raw_snapshot=$2 where job_id=$1", [j, JSON.stringify(snapshot({ upgrades: "Yes", today: "No" }))]);
    expect(await pc.retrySameDayPartC(j, null)).toBe("closed");
    expect(await recovered(j)).toMatchObject([{ details: { audit_id: auditId, reason: "form superseded" } }]);
    expect(await records(j, "post_rectification")).toHaveLength(0);
  });

  test("Minor 2: an unreadable assessment closes nothing (fail-closed)", async () => {
    const { j } = await failedSameDay();
    await db.query("update assessments set status='draft' where job_id=$1", [j]);
    expect(await pc.retrySameDayPartC(j, null)).toBe("none");
    expect(await recovered(j)).toHaveLength(0);
  });

  test("Minor 3: the tick says why this sweep doesn't flip ok", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    const block = tick.slice(tick.indexOf("same-day Part C retry sweep failed") - 200, tick.indexOf("same-day Part C retry sweep failed") + 300);
    expect(block).toMatch(/ok/);
    expect(block).toMatch(/unlike/i);
  });
});
