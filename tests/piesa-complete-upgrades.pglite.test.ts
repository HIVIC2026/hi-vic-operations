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
mock.module("../src/lib/repeat-piesa.server", () => ({ currentPiesaSupersededByReopen: async () => false }));
const realFixes = await import("../src/lib/fixes-day.server");
mock.module("../src/lib/fixes-day.server", () => ({ ...realFixes, closeUnusedRectificationForm: async () => undefined }));
const inHouseJobs = new Set<string>();
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({ ...realSuppression, inHouseDispatchSkip: async (job: string) => (inHouseJobs.has(job) ? "in_house" : null) }));

const { completePiesaAssessment } = await import("../src/lib/piesa-complete.server");
const cls = await import("../src/lib/certificate-later.server");
const auto = await import("../src/lib/own-job-piesa-complete.server");
const ownCore = await import("../src/lib/own-job-piesa.core");
const needsCore = await import("../src/lib/office-needs.core");

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
    expect(depositCalls).not.toContain(j);
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
    expect(depositCalls.filter((x) => x === j)).toHaveLength(1);
    const f = await cls.jobCertificateFacts(j);
    expect(f).toMatchObject({ partCRecorded: true, upgradesDoneAt: "2026-11-03", state: "waiting_for_certificate" });
    expect(await events(j, "piesa_recorded")).toMatchObject([{ details: { source: "mitti_a3_same_day", audit_id: expect.stringMatching(/^audit-/) } }]);
    // A second Complete PIESA is refused (already complete) and writes nothing.
    expect(await run(j)).toMatch(/already complete/);
    expect(await records(j, "post_rectification")).toHaveLength(1);
  });

  test("(b) the Part C date is the certificate date on the answers when given", async () => {
    const { j } = await seedJob({ snap: { upgrades: "Yes", today: "Yes", certNow: "No", certDate: "2026-11-02" } });
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
    expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("completed");
    expect(await stageOf(j)).toBe("installation_scheduling");
    expect(await records(j, "initial")).toMatchObject([{ signed_off_by: U_ELEC }]);
    expect(await records(j, "post_rectification")).toHaveLength(1);
    expect(await events(j, ownCore.PIESA_AUTO_COMPLETED_EVENT)).toHaveLength(1);
    // A re-sync of the same form does nothing (the PIESA is no longer at booked).
    expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("not_due");
    expect(await records(j)).toHaveLength(2);
  });

  test("(d) a refused auto-complete leaves ONE office row and the stage unchanged", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "Yes", today: "No" } });
    entryBlock = "Owner paperwork not signed";
    try {
      expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("held");
      expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("already");
    } finally { entryBlock = null; }
    expect(await stageOf(j)).toBe("piesa_scheduled");
    const held = await events(j, ownCore.OWN_JOB_PIESA_COMPLETE_HELD_EVENT);
    expect(held).toHaveLength(1);
    const reason = String(held[0]!.details["reason"]);
    expect(reason).toBe("PIESA cannot be completed yet: Owner paperwork not signed");
    expect(held[0]!.details).toMatchObject({ audit_id: auditId, needs_office: true });
    expect(await records(j)).toHaveLength(0);
    // The office row says what happened, plainly, with Open job.
    const rows = needsCore.needsCandidates({ jobId: j, jobNumber: "HV-1", ownJobPiesaCompleteHeld: { at: "2026-11-04T00:00:00.000Z", reason } } as never, Date.now());
    expect(rows.find((r) => r.kind === "own_job_piesa_complete_held")).toMatchObject({ line: expect.stringMatching(/^PIESA done in Mitti but couldn't be completed — PIESA cannot be completed yet: Owner paperwork not signed/), button: { label: "Open job" } });
    // Open only while the PIESA is still booked.
    expect(ownCore.ownJobPiesaCompleteHeldOpen([{ event_type: ownCore.OWN_JOB_PIESA_COMPLETE_HELD_EVENT, created_at: "2026-11-04T00:00:00Z", details: { reason: "x" } }], "piesa_scheduled")).toMatchObject({ reason: "x" });
    expect(ownCore.ownJobPiesaCompleteHeldOpen([{ event_type: ownCore.OWN_JOB_PIESA_COMPLETE_HELD_EVENT, created_at: "2026-11-04T00:00:00Z", details: { reason: "x" } }], "piesa_complete")).toBeNull();
  });

  test("(e) an HIV lead is not auto-completed (the electrician or office presses Complete PIESA)", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "No" }, channel: "hivic_sourced" });
    expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("not_own_job");
    expect(await stageOf(j)).toBe("piesa_scheduled");
    expect(await events(j, ownCore.PIESA_AUTO_COMPLETED_EVENT)).toHaveLength(0);
  });

  test("(e) an in-house partner job is not auto-completed", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "No" } });
    inHouseJobs.add(j);
    expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("not_own_job");
    expect(await stageOf(j)).toBe("piesa_scheduled");
  });

  test("not at PIESA booked → nothing claimed", async () => {
    const { j, auditId } = await seedJob({ snap: { upgrades: "No" }, stage: "piesa_and_install_window_pending" });
    expect(await auto.autoCompleteOwnJobPiesa(j, auditId, null)).toBe("not_due");
    expect(await events(j, ownCore.PIESA_AUTO_COMPLETED_EVENT)).toHaveLength(0);
  });

  test("wiring: the A3 sync calls the auto-complete on a Complete form only; the office reads the held row", () => {
    const sync = readFileSync("src/lib/mitti.server.ts", "utf8");
    expect(sync).toMatch(/if \(completed\) await \(await import\("\.\/own-job-piesa-complete\.server"\)\)\.autoCompleteOwnJobPiesa\(jobId, a\.external_mitti_id, actorId\)/);
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(needs).toContain("ownJobPiesaCompleteHeldOpen");
    const link = readFileSync("src/lib/electrician-link.server.ts", "utf8");
    expect(link).toContain("const piesaDone = piesaDoneAtStage(stage);");
  });
});
