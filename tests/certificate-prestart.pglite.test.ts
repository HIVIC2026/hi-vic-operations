// Part 3 Task 4 (Jo 3 Nov 2026): the install can be BOOKED while the Certificate of Electrical Safety is outstanding; it
// can't START. On real rows (PGlite): the pre-start certificate fact (certificate-later.server `prestartCertificateFacts`,
// read by prestart.server `prestartFacts`) through the pure pre-start rule, and the booking warning recorded once per start.
// coes-check.server (currentCoes / coesState) is the REAL code.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL, ONSITE_START_LABEL } from "../src/lib/official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";
import { INSTALL_CERTIFICATE_WARNING, INSTALL_CERTIFICATE_WARNING_EVENT } from "../src/lib/certificate-later.core";
import { prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { coesPortalKey } from "../src/lib/coes-check.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text);
CREATE TABLE jobs (id uuid primary key, stage text, source text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, from_stage text, to_stage text, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, full_legal_name text, removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, assigned_at timestamptz default clock_timestamp());
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, mitti_raw_snapshot jsonb, completed_at timestamptz);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, outcome text, completed_date date, signed_off_by uuid, rectification_completed_at timestamptz, section_c_signed_at timestamptz, is_current boolean default true, created_at timestamptz default clock_timestamp());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text);
CREATE TABLE evidence_files (id uuid primary key default gen_random_uuid(), requirement_id uuid, job_id uuid, storage_path text, mime_type text, uploaded_at timestamptz default clock_timestamp());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, mime_type text, external_id text, source_system text, created_at timestamptz default clock_timestamp());
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, description text, status text);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, created_at timestamptz default clock_timestamp());
`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown, opts?: { internal?: boolean }) => {
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,$6)", [job, actor, type, summary, JSON.stringify(details ?? {}), opts?.internal ?? false]);
  },
}));

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ELEC = id(2), U1 = id(11);
await db.query(`insert into businesses values ($1,'Sparky Co','Sparky Co')`, [ELEC]);
await db.query(`insert into partner_workers (business_id, profile_id, full_legal_name) values ($1,$2,'Sparky Sam')`, [ELEC, U1]);
const snapshot = (o: { upgrades: "Yes" | "No"; today?: "Yes" | "No" }) => [
  { label: A3_REPAIR_NEEDED_LABEL, value: o.upgrades },
  ...(o.today ? [{ label: A3_UPGRADES_TODAY_LABEL, value: o.today }, { label: CERTIFICATE_NOW_LABEL, value: "No" }] : []),
  { label: PIESA_EVIDENCE_BY_ID.ces_file.label, value: null, media: [] },
];

async function seedJob(j: string, o: { snap: unknown; record?: boolean; file?: boolean; item?: boolean }) {
  await db.query("insert into jobs values ($1,'installation_scheduling','qa_test')", [j]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U1]);
  await db.query("insert into assessments (job_id, mitti_raw_snapshot, completed_at) values ($1,$2,now())", [j, JSON.stringify(o.snap)]);
  await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, signed_off_by) values ($1,'initial','fail','2026-11-01',$2)", [j, U1]);
  if (o.item) await db.query("insert into rectification_items (job_id, description, status) values ($1,'Replace split conduit','required')", [j]);
  if (o.record) await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, rectification_completed_at, section_c_signed_at) values ($1,'post_rectification','pass','2026-11-03','2026-11-03','2026-11-03')", [j]);
  if (o.file) {
    const req = (await db.query<{ id: string }>("insert into evidence_requirements (job_id, category) values ($1,'rectification_completion') returning id", [j])).rows[0]!.id;
    return (await db.query<{ id: string }>("insert into evidence_files (requirement_id, job_id, storage_path, mime_type) values ($1,$2,$3,'application/pdf') returning id", [req, j, `jobs/${j}/electrician-uploads/abcdefgh.pdf`])).rows[0]!.id;
  }
  return null;
}
const J_NONE = id(301), J_MISSING = id(302), J_UNCHECKED = id(303), J_TICKED = id(304), J_ONSITE = id(305), J_SAMEDAY = id(306), J_REJECTED = id(307);
await seedJob(J_NONE, { snap: snapshot({ upgrades: "No" }) });
await seedJob(J_MISSING, { snap: snapshot({ upgrades: "Yes", today: "Yes" }), record: true, item: true });
const fUnchecked = await seedJob(J_UNCHECKED, { snap: snapshot({ upgrades: "Yes", today: "Yes" }), record: true, file: true, item: true });
const fTicked = await seedJob(J_TICKED, { snap: snapshot({ upgrades: "Yes", today: "Yes" }), record: true, file: true, item: true });
await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'coes_checked','ticked',$2,true)", [J_TICKED, JSON.stringify({ by: "office", verdict: "ceiling_work", key: coesPortalKey([fTicked!]) })]);
const fRejected = await seedJob(J_REJECTED, { snap: snapshot({ upgrades: "Yes", today: "Yes" }), record: true, file: true, item: true });
await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'coes_rejected','rejected',$2,true)", [J_REJECTED, JSON.stringify({ by: "office", note: "wrong address", key: coesPortalKey([fRejected!]) })]);
await seedJob(J_ONSITE, { snap: [{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }, { label: A3_UPGRADES_TODAY_LABEL, value: "No" }, { label: ONSITE_START_LABEL, value: "Yes" }], item: true });
// Same-day upgrades on the A3, certificate to come: Part C on the answers, no post-upgrades record (Review Focus 4 → 5).
await seedJob(J_SAMEDAY, { snap: snapshot({ upgrades: "Yes", today: "Yes" }), item: true });
void fUnchecked;

const cls = await import("../src/lib/certificate-later.server");
const { clearanceFacts } = await import("../src/lib/electrical-clearance.server");
const { electricalClearance } = await import("../src/lib/allocation.core");
const START = "2026-11-20T21:00:00Z";
const ok: PrestartFacts = {
  start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-11-30", esc: { status: "sent", sent_at: "2026-11-18T00:00:00Z", submission_reference: "R", scheduled_start: START },
  lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee" }, consentBlockers: [], piesaCompletedAt: "2026-11-01",
};
const failuresFor = async (j: string, onsiteOnly = false) => {
  const c = await cls.prestartCertificateFacts(j, { onsiteOnly });
  return prestartFailures({ ...ok, certificate: c.certificate, certificateWhy: c.certificateWhy });
};
const warnings = async (j: string) => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2", [j, INSTALL_CERTIFICATE_WARNING_EVENT])).rows.map((r) => r.details);

describe("pre-start reads the certificate", () => {
  test("no upgrades → not needed, passes", async () => {
    expect(await cls.prestartCertificateFacts(J_NONE, { onsiteOnly: false })).toMatchObject({ certificate: "not_needed" });
    expect(await failuresFor(J_NONE)).toEqual([]);
  });
  test("Review Focus 5: booked, certificate still missing at the day-before check → 'Certificate of Electrical Safety not in yet'", async () => {
    expect(await cls.prestartCertificateFacts(J_MISSING, { onsiteOnly: false })).toMatchObject({ certificate: "missing", state: "waiting_for_certificate" });
    expect(await failuresFor(J_MISSING)).toEqual(["Certificate of Electrical Safety not in yet"]);
  });
  test("a file on the job, not ticked → 'Check electrical certificate — not checked yet'", async () => {
    expect(await failuresFor(J_UNCHECKED)).toEqual(["Check electrical certificate — not checked yet"]);
  });
  test("office rejected it → the check's own reason", async () => {
    expect(await failuresFor(J_REJECTED)).toEqual(["Check electrical certificate — you rejected it (wrong address) — waiting for a new certificate"]);
  });
  test("ticked → passes", async () => {
    expect(await cls.prestartCertificateFacts(J_TICKED, { onsiteOnly: false })).toMatchObject({ certificate: "ticked" });
    expect(await failuresFor(J_TICKED)).toEqual([]);
  });
  test("on-site-only → clear after the PIESA (no certificate asked for)", async () => {
    expect((await clearanceFacts(J_ONSITE)).onsiteStartOnly).toBe(true);
    expect(await failuresFor(J_ONSITE, true)).toEqual([]);
  });
});

describe("clearance needs Part C, not the certificate", () => {
  test("same-day upgrades on the A3 (no post-upgrades record, no certificate) → cleared; the pre-start then fails on the certificate", async () => {
    const cf = await clearanceFacts(J_SAMEDAY);
    expect(cf.partCRecorded).toBe(true);
    expect(electricalClearance(cf)).toMatchObject({ cleared: true, basis: "section_c" });
    expect(String(electricalClearance(cf).timingDate).slice(0, 10)).toBe("2026-11-01"); // the 30 days still run from the PIESA
    expect(await failuresFor(J_SAMEDAY)).toEqual(["Certificate of Electrical Safety not in yet"]);
  });
  test("A4 recorded without a certificate → cleared", async () => {
    expect(electricalClearance(await clearanceFacts(J_MISSING))).toMatchObject({ cleared: true, basis: "section_c" });
  });
});

describe("booking the install with the certificate outstanding", () => {
  test("allowed with the warning: recorded once per start, returned for the screen", async () => {
    expect(await cls.recordInstallCertificateWarning(J_MISSING, U1, START)).toBe(INSTALL_CERTIFICATE_WARNING);
    expect(await cls.recordInstallCertificateWarning(J_MISSING, U1, new Date(START).toISOString())).toBe(INSTALL_CERTIFICATE_WARNING);
    expect(await warnings(J_MISSING)).toEqual([{ scheduled_start: new Date(START).toISOString(), warning: INSTALL_CERTIFICATE_WARNING }]);
    // A moved day is a new start → recorded again.
    await cls.recordInstallCertificateWarning(J_MISSING, U1, "2026-11-21T21:00:00Z");
    expect(await warnings(J_MISSING)).toHaveLength(2);
    // A file waiting for its check is still outstanding.
    expect(await cls.recordInstallCertificateWarning(J_UNCHECKED, U1, START)).toBe(INSTALL_CERTIFICATE_WARNING);
  });
  test("no warning when ticked, not needed, or on-site-only", async () => {
    for (const j of [J_TICKED, J_NONE, J_ONSITE]) {
      expect(await cls.recordInstallCertificateWarning(j, U1, START)).toBeNull();
      expect(await warnings(j)).toEqual([]);
    }
  });
  test("every install booking path records it; the booking gate is gone; the pre-start reads it", () => {
    const src = (f: string) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
    expect(src("workflow.server.ts")).not.toContain("coesBlockerFor(");
    expect(src("booking.server.ts")).toMatch(/kind === "installation" \? await \(await import\("\.\/certificate-later\.server"\)\)\.recordInstallCertificateWarning\(jobId, actorId, start\)/);
    expect(src("trade-view.server.ts")).toContain("recordInstallCertificateWarning(input.jobId,userId,input.start)");
    expect(src("install-days.server.ts")).toContain("booked.warning");
    expect(src("prestart.server.ts")).toContain("prestartCertificateFacts(jobId, { onsiteOnly: cf.onsiteStartOnly === true })");
  });
});
