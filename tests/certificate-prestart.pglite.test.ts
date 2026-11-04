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
import { INSTALL_CERTIFICATE_UNCHECKED_WARNING, INSTALL_CERTIFICATE_WARNING, INSTALL_CERTIFICATE_WARNING_EVENT } from "../src/lib/certificate-later.core";
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
-- The live one-current-record-per-job index (drizzle/migrations/0000_hivic_core_schema.sql:176).
create unique index if not exists piesa_current_uq on piesa_records(job_id) where is_current;
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text);
CREATE TABLE evidence_files (id uuid primary key default gen_random_uuid(), requirement_id uuid, job_id uuid, storage_path text, mime_type text, uploaded_at timestamptz default clock_timestamp());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, mime_type text, external_id text, source_system text, created_at timestamptz default clock_timestamp());
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, description text, status text);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, created_at timestamptz default clock_timestamp());
`);
// Fix 1: the in-house install form seams (no Mitti, no sends) and an in-memory "job-files" bucket for the AI tick.
await db.exec(`
ALTER TABLE businesses ADD COLUMN email text;
ALTER TABLE bookings ADD COLUMN assignment_id uuid;
ALTER TABLE partner_workers ADD COLUMN email text, ADD COLUMN worker_role text, ADD COLUMN trade_role text;
ALTER TABLE assessments ADD COLUMN external_mitti_id text, ADD COLUMN status text, ADD COLUMN mitti_completed boolean;
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, external_source text, external_id text, status text, is_current boolean default true);
ALTER TABLE jobs ADD COLUMN job_number text, ADD COLUMN deleted_at timestamptz, ADD COLUMN qa_archived_at timestamptz;
ALTER TABLE quotes ADD COLUMN version int, ADD COLUMN customer_total_inc_gst numeric, ADD COLUMN accepted_at timestamptz;
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, expires_at date, verification text);
CREATE TABLE pre_start_checks (id uuid primary key default gen_random_uuid(), job_id uuid, booking_id uuid, scheduled_start timestamptz, passed boolean, failures jsonb, trigger text, checked_at timestamptz default clock_timestamp());
-- Joined branch (4 Nov 2026): Part 9 Task 5's GO check facts read the life support answer and plan (job-records.server).
ALTER TABLE jobs ADD COLUMN life_support boolean not null default false, ADD COLUMN life_support_status text;
-- Part 9 Task 14: the GO check reads the "no ESC" real-run marker from jobs.external_refs (fails closed without the column).
ALTER TABLE jobs ADD COLUMN external_refs jsonb;
CREATE TABLE job_compliance_records (id uuid primary key default gen_random_uuid(), job_id uuid, record_key text, occurred_at timestamptz, reference text, notes text);
`);
const stored = new Map<string, Uint8Array>();
const storage = { from: (_b: string) => ({ download: async (path: string) => { const b = stored.get(path); return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "not found" } }; } }) };
const shim = postgrestShim(db);
const PROFILE_EMAIL = new Map<string, string>();
// The shim has no .range(): the in-house form reader pages by 200 — the first page is a LIMIT (more pages never happen here).
const admin = { ...shim, storage, from(table: string) {
  const b = shim.from(table) as ReturnType<typeof shim.from> & { limit: (n: number) => unknown; range?: (a: number, z: number) => unknown };
  b.range = (a: number, z: number) => { if (a !== 0) throw new Error("range offset not supported in this test"); return b.limit(z - a + 1); };
  // Nor embedded joins: job_assignments "profiles:user_id(email,full_name)" is read from the test's profile emails.
  if (table === "job_assignments") {
    const sel = b.select.bind(b), run = b.run.bind(b);
    let embed = false;
    (b as { select: (c?: string, o?: unknown) => unknown }).select = (c = "*", o?: unknown) => { embed = c.includes("profiles:"); return sel(embed ? c.replace(/,?\s*profiles:user_id\([^)]*\)/, "") : c, o as never); };
    (b as { run: () => Promise<unknown> }).run = async () => {
      const r = (await run()) as { data: unknown };
      const add = (row: Record<string, unknown> | null) => row && embed ? { ...row, profiles: { email: PROFILE_EMAIL.get(String(row["user_id"])) ?? null, full_name: null } } : row;
      return { ...r, data: Array.isArray(r.data) ? r.data.map(add) : add(r.data as Record<string, unknown> | null) };
    };
  }
  return b;
} };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
const IN_HOUSE = new Set<string>();
// Task 4b carried minor: jobs whose partner read fails (readInHouseDispatchState → failed).
const PARTNER_READ_FAILS = new Set<string>();
const piisaCreates: string[] = [], formDates: unknown[][] = [], piisaNoAssignee: string[] = [];
mock.module("../src/lib/in-house-suppression.server", () => ({
  readInHouseDispatchState: async (ids?: string[]) => ({ failed: (ids ?? []).some((i) => PARTNER_READ_FAILS.has(i)), held: new Set((ids ?? [...IN_HOUSE]).filter((i) => IN_HOUSE.has(i))) }),
  inHouseDispatchSkip: async (j: string) => (IN_HOUSE.has(j) ? "in_house" : null),
}));
mock.module("../src/lib/mitti.server", () => ({
  realMittiCall: async () => { throw new Error("Unexpected Mitti call"); },
  createPiisaMittiAudit: async (j: string, _a: string | null, _c?: unknown, o?: { assignee?: { email: string } }) => {
    piisaCreates.push(j);
    if (!o?.assignee) piisaNoAssignee.push(j); // fix 2: the auto-send's call (no Lead Installer) — must never happen for in-house jobs
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'mitti_piisa_audit_created','PIISA created',$2,true)", [j, JSON.stringify({ audit_id: `A5-${j}`, email: o?.assignee?.email ?? null })]);
    return { auditId: `A5-${j}` };
  },
  findMittiUserByEmail: async (e: string) => e, reassignMittiFormTo: async () => {}, updateMittiInstallCrew: async () => {},
}));
mock.module("../src/lib/mitti-pickup.server", () => ({ updateMittiFormDate: async (...p: unknown[]) => { formDates.push(p); return { updated: true }; } }));
mock.module("../src/lib/coes-owner-copy.server", () => ({ sendCoesOwnerCopy: async () => "test: not sent" }));
mock.module("../src/lib/in-house-booking.server", () => ({ leadNoticeBlocker: async () => null, latestLeadNotice: async () => null }));
mock.module("../src/lib/ready-check-draft.server", () => ({ rcWorksBlockers: async () => [] }));
mock.module("../src/lib/installer-intake.server", () => ({ siteConditionsHoldFor: async () => ({ open: false, note: null }) }));
// Fix 2: runPrestart's fact gathering runs for real; the pure verdict can be forced so a "Run check" pass is reachable
// without seeding every pre-start reader (consent, ESC, SWMS, payments …). null = the real rule.
let FORCED_FAILURES: string[] | null = null;
const realPrestartCore = await import("../src/lib/prestart.core");
const realPrestartFailures = realPrestartCore.prestartFailures;
mock.module("../src/lib/prestart.core", () => ({ ...realPrestartCore, prestartFailures: (f: PrestartFacts) => FORCED_FAILURES ?? realPrestartFailures(f) }));
const realConsent = await import("../src/lib/consent.server");
mock.module("../src/lib/consent.server", () => ({ ...realConsent, currentConsent: async () => null }));
const realPayments = await import("../src/lib/payments.server");
mock.module("../src/lib/payments.server", () => ({ ...realPayments, jobPaymentView: async () => null }));
const realEsc = await import("../src/lib/esc.server");
mock.module("../src/lib/esc.server", () => ({ ...realEsc, piesaCopyDeliveries: async () => [] }));
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
  // One current record per job (piesa_current_uq): the initial record stops being current once Part C is recorded.
  await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, signed_off_by, is_current) values ($1,'initial','fail','2026-11-01',$2,$3)", [j, U1, !o.record]);
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
// Same-day upgrades on the A3, certificate to come: Part C on the answers, no post-upgrades record — an A3 completed before
// Task 4b (Complete PIESA now writes the record; tests/piesa-complete-upgrades.pglite.test.ts). Review Focus 4 → 5.
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
    // A file waiting for its check is still outstanding — fix 1: with its own line ("not checked yet").
    expect(await cls.recordInstallCertificateWarning(J_UNCHECKED, U1, START)).toBe(INSTALL_CERTIFICATE_UNCHECKED_WARNING);
  });
  test("no warning when ticked, not needed, or on-site-only", async () => {
    for (const j of [J_TICKED, J_NONE, J_ONSITE]) {
      expect(await cls.recordInstallCertificateWarning(j, U1, START)).toBeNull();
      expect(await warnings(j)).toEqual([]);
    }
  });
  test("J5 (join ruling 2, 'double warning'): while the upgrades themselves are outstanding (install booked before the upgrades day) the certificate line is NOT shown or recorded — Task 10's upgrades line carries the booking alone", async () => {
    const J_OPEN = id(308);
    await seedJob(J_OPEN, { snap: snapshot({ upgrades: "Yes", today: "No" }), item: true });
    expect(electricalClearance(await clearanceFacts(J_OPEN))).toMatchObject({ cleared: false, blocker: "Electrical upgrades not completed yet." });
    expect(await cls.recordInstallCertificateWarning(J_OPEN, U1, START)).toBeNull();
    expect(await warnings(J_OPEN)).toEqual([]);
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

// ---------- Fix 1 (controller ruling 4 Nov 2026): in-house jobs can't start without the certificate either ----------
const IB = id(3), UI = id(12), OFFICE = id(13), LEAD = id(401), BOOK_AT = "2027-03-10T21:00:00Z";
PROFILE_EMAIL.set(UI, "office@rapid.invalid");
await db.query(`insert into businesses (id, name, trading_name, email) values ($1,'Rapid','Rapid','office@rapid.invalid')`, [IB]);
await db.query(`insert into partner_workers (id, business_id, full_legal_name, email, worker_role, trade_role) values ($1,$2,'Lee Lead','lee@rapid.invalid','lead','installer')`, [LEAD, IB]);
async function seedInHouse(j: string, o: { upgrades: boolean; file?: boolean; lead?: boolean }) {
  const f = await seedJob(j, o.upgrades ? { snap: snapshot({ upgrades: "Yes", today: "Yes" }), record: true, item: true, file: o.file } : { snap: snapshot({ upgrades: "No" }) });
  await db.query("update jobs set stage='installation_booked' where id=$1", [j]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3)", [j, IB, UI]);
  if (o.lead !== false) await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'visit_allocated','allocated',$2,true)", [j, JSON.stringify({ visit: "install", worker_id: LEAD })]);
  await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'installation','confirmed',$2)", [j, BOOK_AT]);
  IN_HOUSE.add(j);
  return f;
}
const addFile = async (j: string) => {
  const req = (await db.query<{ id: string }>("insert into evidence_requirements (job_id, category) values ($1,'rectification_completion') returning id", [j])).rows[0]!.id;
  const path = `jobs/${j}/electrician-uploads/abcdefgh.pdf`;
  stored.set(path, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...Array(40).fill(0x20)]));
  return (await db.query<{ id: string }>("insert into evidence_files (requirement_id, job_id, storage_path, mime_type) values ($1,$2,$3,'application/pdf') returning id", [req, j, path])).rows[0]!.id;
};
const J_IH = id(501), J_IH_AI = id(502), J_IH_NONE = id(503), J_IH_LOCKED = id(504), J_IH_BROKEN = id(505);
await seedInHouse(J_IH, { upgrades: true });
await seedInHouse(J_IH_AI, { upgrades: true });
await seedInHouse(J_IH_NONE, { upgrades: false });
await seedInHouse(J_IH_LOCKED, { upgrades: true });
await seedInHouse(J_IH_BROKEN, { upgrades: true, lead: false });
const forms = await import("../src/lib/in-house-forms.server");
const coes = await import("../src/lib/coes-check.server");
const prestart = await import("../src/lib/prestart.server");
const eventsOf = async (j: string, type: string) => (await db.query<{ summary: string; details: Record<string, unknown>; internal: boolean }>("select summary, details, internal from workflow_events where job_id=$1 and event_type=$2", [j, type])).rows;
// The booking path as booking.server confirmBooking runs it for an in-house install (its catch records in_house_form_sync_failed).
const bookingFormsStep = async (j: string) => {
  try { if (await forms.isInHouseFormJob(j)) { await forms.ensureInstallForm(j, UI); await forms.syncInHouseForms(j, "date", UI); } }
  catch (e) { await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'in_house_form_sync_failed','x',$2,true)", [j, JSON.stringify({ reason: (e as Error).message })]); }
};

describe("fix 1: in-house install form held while the certificate is outstanding", () => {
  test("booked with the certificate missing → booking ok, no install form, one held event, no sync failure", async () => {
    await bookingFormsStep(J_IH); await bookingFormsStep(J_IH);
    expect(piisaCreates).toEqual([]);
    const held = await eventsOf(J_IH, "in_house_install_form_held");
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ summary: "Install form held until the Certificate of Electrical Safety is ticked", internal: true });
    expect(held[0]!.details["needs_office"]).toBeUndefined();
    expect(await eventsOf(J_IH, "in_house_form_sync_failed")).toEqual([]);
    expect(formDates).toEqual([]);
  });
  test("can't start: missing → 'not in yet'; a file not ticked → 'check the electrical certificate'", async () => {
    await expect(prestart.requirePrestartClear(J_IH)).rejects.toThrow("Not cleared to start: Certificate of Electrical Safety not in yet.");
    await addFile(J_IH);
    await expect(prestart.requirePrestartClear(J_IH)).rejects.toThrow("Not cleared to start: check the electrical certificate — not checked yet.");
    await bookingFormsStep(J_IH);
    expect(piisaCreates).toEqual([]);
    expect(await eventsOf(J_IH, "in_house_install_form_held")).toHaveLength(1);
  });
  test("office tick → the install form is created once (dated); a second tick makes no second form", async () => {
    await coes.officeTickCoes(J_IH, null, OFFICE);
    expect(piisaCreates).toEqual([J_IH]);
    expect(formDates.map((p) => [p[0], p[1], (p[4] as { auditId?: string } | undefined)?.auditId])).toEqual([[J_IH, new Date(BOOK_AT).toISOString(), `A5-${J_IH}`]]);
    await expect(prestart.requirePrestartClear(J_IH)).resolves.toBeUndefined();
    await coes.officeRejectCoes(J_IH, null, "blurry", OFFICE);
    await coes.officeTickCoes(J_IH, null, OFFICE);
    expect(piisaCreates).toEqual([J_IH]);
    expect(await eventsOf(J_IH, "in_house_form_sync_failed")).toEqual([]);
  });
  test("AI tick (checkCurrentCoes) also creates the held form", async () => {
    await bookingFormsStep(J_IH_AI);
    await addFile(J_IH_AI);
    expect(await coes.checkCurrentCoes(J_IH_AI, null)).toBe("ticked by AI");
    expect(piisaCreates).toEqual([J_IH, J_IH_AI]);
  });
  test("a tick while the day-before check still says failed waits; the next pre-start pass creates the form", async () => {
    await bookingFormsStep(J_IH_LOCKED);
    const f = await addFile(J_IH_LOCKED);
    await db.query("insert into pre_start_checks (job_id, scheduled_start, passed, failures, trigger) values ($1,$2,false,$3,'timer')", [J_IH_LOCKED, BOOK_AT, JSON.stringify(["Check electrical certificate — not checked yet"])]);
    expect((await prestart.prestartGate(J_IH_LOCKED)).locked).toBe(true);
    await coes.officeTickCoes(J_IH_LOCKED, null, OFFICE);
    expect(piisaCreates).not.toContain(J_IH_LOCKED);
    expect(await eventsOf(J_IH_LOCKED, "in_house_form_sync_failed")).toEqual([]);
    void f;
    // sweepPrestart records the pass, then runs the same release (the real sweep needs every pre-start reader; pinned below).
    await db.query("insert into pre_start_checks (job_id, scheduled_start, passed, failures, trigger) values ($1,$2,true,'[]','timer')", [J_IH_LOCKED, BOOK_AT]);
    expect(await forms.releaseHeldInstallForm(J_IH_LOCKED, null)).toBe("created");
    expect(piisaCreates).toContain(J_IH_LOCKED);
    expect(await forms.releaseHeldInstallForm(J_IH_LOCKED, null)).toBe("already has an install form");
  });
  test("a creation failure after the tick is an office item; the tick itself still succeeds", async () => {
    await bookingFormsStep(J_IH_BROKEN);
    await addFile(J_IH_BROKEN);
    await expect(coes.officeTickCoes(J_IH_BROKEN, null, OFFICE)).resolves.toEqual({ ok: true });
    expect(piisaCreates).not.toContain(J_IH_BROKEN);
    const failed = await eventsOf(J_IH_BROKEN, "in_house_form_sync_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.details).toMatchObject({ needs_office: true, reason: "Choose the Lead Installer before creating the install form." });
  });
  test("HIV-lead job with no upgrades → install form created at booking as before", async () => {
    await bookingFormsStep(J_IH_NONE);
    expect(piisaCreates).toContain(J_IH_NONE);
    expect(await eventsOf(J_IH_NONE, "in_house_install_form_held")).toEqual([]);
  });
  test("requirePrestartClear: live certificate check — throws on missing / unchecked, passes on ticked / not needed / on-site-only", async () => {
    await expect(prestart.requirePrestartClear(J_MISSING)).rejects.toThrow("Not cleared to start: Certificate of Electrical Safety not in yet.");
    await expect(prestart.requirePrestartClear(J_UNCHECKED)).rejects.toThrow("Not cleared to start: check the electrical certificate — not checked yet.");
    for (const j of [J_TICKED, J_NONE, J_ONSITE]) await expect(prestart.requirePrestartClear(j)).resolves.toBeUndefined();
  });
  test("the booking warning picks its line from the fact: a file not ticked → 'not checked yet'", async () => {
    expect(await cls.recordInstallCertificateWarning(J_UNCHECKED, U1, "2026-11-25T21:00:00Z")).toBe(INSTALL_CERTIFICATE_UNCHECKED_WARNING);
  });
  test("wiring: the sweep releases the held form on a pass; the tick paths release it; the PIISA auto-send still decides on the gate first", () => {
    const src = (f: string) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
    // Fix 2: the release lives in runPrestart (every caller: the sweep, office "Run check", ESC paths), on ANY pass.
    const run = src("prestart.server.ts").split("export async function runPrestart")[1]!.split("\nexport ")[0]!;
    expect((run.match(/if \(passed\) await afterPrestartPass\(jobId\)/g) ?? []).length).toBe(2);
    expect(src("coes-check.server.ts")).toMatch(/releaseHeldAfterTick\(jobId, actorId\)/);
    const auto = src("piisa-autosend.server.ts");
    expect(auto.indexOf("prestartGate(j.id, now)")).toBeGreaterThan(-1);
    expect(auto.indexOf("prestartGate(j.id, now)")).toBeLessThan(auto.indexOf("createPiisaMittiAudit(j.id"));
  });
});

// ---------- Fix 2 (reviewer, fix round 1): the held form is released on ANY recorded pass; the auto-send skips in-house ----------
const NOW = new Date("2027-03-10T05:00:00Z"); // 4pm Melbourne the day before BOOK_AT (11 Mar 8am): inside the check window
const J_IH_RUN = id(506), J_IH_SWEEP = id(507), J_OWN = id(508);
await seedInHouse(J_IH_RUN, { upgrades: true });
await seedInHouse(J_IH_SWEEP, { upgrades: true });
// An own job (not in-house), no upgrades, booked for the same start: the auto-send makes its form as before.
await seedJob(J_OWN, { snap: snapshot({ upgrades: "No" }) });
await db.query("update jobs set stage='installation_booked' where id=$1", [J_OWN]);
await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'installation','confirmed',$2)", [J_OWN, BOOK_AT]);
const checks = async (j: string) => (await db.query<{ passed: boolean; trigger: string }>("select passed, trigger from pre_start_checks where job_id=$1 order by checked_at", [j])).rows;

describe("fix 2: held in-house install form released on any pre-start pass", () => {
  test("reviewer's scenario: 12pm check fails on the certificate → tick while locked (waits) → office 'Run check' records the pass → form created once; a later sweep makes no second form", async () => {
    await bookingFormsStep(J_IH_RUN);
    await addFile(J_IH_RUN);
    await db.query("insert into pre_start_checks (job_id, scheduled_start, passed, failures, trigger) values ($1,$2,false,$3,'timer')", [J_IH_RUN, BOOK_AT, JSON.stringify(["Check electrical certificate — not checked yet"])]);
    await coes.officeTickCoes(J_IH_RUN, null, OFFICE);
    expect(piisaCreates).not.toContain(J_IH_RUN);
    FORCED_FAILURES = [];
    try {
      expect(await prestart.runPrestart(J_IH_RUN, "office", NOW)).toEqual({ passed: true, failures: [], changed: true, slot: null });
      expect(piisaCreates.filter((j) => j === J_IH_RUN)).toHaveLength(1);
      expect(piisaNoAssignee).not.toContain(J_IH_RUN);
      await prestart.sweepPrestart(NOW);
      expect(piisaCreates.filter((j) => j === J_IH_RUN)).toHaveLength(1);
      // Part 9 Task 6 (joined branch): the due 2pm GO slot always writes its own row once; the form is still made once.
      expect((await checks(J_IH_RUN)).map((c) => [c.trigger, c.passed])).toEqual([["timer", false], ["office", true], ["day_before_2pm", true]]);
    } finally { FORCED_FAILURES = null; }
  });
  test("a pass already on file (changed:false) still releases a held form — once", async () => {
    await bookingFormsStep(J_IH_SWEEP);
    await addFile(J_IH_SWEEP);
    // The pass was recorded earlier by another path (nobody released then); the certificate is ticked after.
    await db.query("insert into pre_start_checks (job_id, scheduled_start, passed, failures, trigger) values ($1,$2,true,'[]','esc_submitted')", [J_IH_SWEEP, BOOK_AT]);
    await db.query("update jobs set stage='installation_scheduling' where id=$1", [J_IH_SWEEP]); // tick before the job is at installation_booked
    await coes.officeTickCoes(J_IH_SWEEP, null, OFFICE);
    await db.query("update jobs set stage='installation_booked' where id=$1", [J_IH_SWEEP]);
    expect(piisaCreates).not.toContain(J_IH_SWEEP);
    const before = (await checks(J_IH_SWEEP)).length;
    FORCED_FAILURES = [];
    try {
      expect(await prestart.runPrestart(J_IH_SWEEP, "timer", NOW)).toEqual({ passed: true, failures: [], changed: false, slot: null });
      expect(piisaCreates.filter((j) => j === J_IH_SWEEP)).toHaveLength(1);
      await prestart.sweepPrestart(NOW);
      await prestart.sweepPrestart(NOW);
      expect(piisaCreates.filter((j) => j === J_IH_SWEEP)).toHaveLength(1);
      expect(await checks(J_IH_SWEEP)).toHaveLength(before); // nothing new recorded: every pass was "unchanged"
    } finally { FORCED_FAILURES = null; }
  });
  test("a release that keeps failing is ONE office row, not a new one every sweep", async () => {
    // J_IH_BROKEN (no Lead Installer) already has its one failure row from the tick above.
    expect(await eventsOf(J_IH_BROKEN, "in_house_form_sync_failed")).toHaveLength(1);
    FORCED_FAILURES = [];
    try { await prestart.sweepPrestart(NOW); await prestart.sweepPrestart(NOW); } finally { FORCED_FAILURES = null; }
    expect(piisaCreates).not.toContain(J_IH_BROKEN);
    expect(await eventsOf(J_IH_BROKEN, "in_house_form_sync_failed")).toHaveLength(1);
    // Once the office has recovered it, a later failure is a new row.
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'in_house_form_sync_recovered','recovered','{}',true)", [J_IH_BROKEN]);
    FORCED_FAILURES = [];
    try { await prestart.sweepPrestart(NOW); await prestart.sweepPrestart(NOW); } finally { FORCED_FAILURES = null; }
    const failed = await eventsOf(J_IH_BROKEN, "in_house_form_sync_failed");
    expect(failed).toHaveLength(2);
    expect(failed[1]!.details).toMatchObject({ needs_office: true, reason: "Choose the Lead Installer before creating the install form." });
  });
});

describe("fix 2: the PIISA auto-send skips in-house jobs", () => {
  test("an in-house job with no install form is skipped with the reason (never sent to the installer office's login); an own job is created as before", async () => {
    const { sweepPiisaAutoSend } = await import("../src/lib/piisa-autosend.server");
    const r = await sweepPiisaAutoSend({ now: NOW, allowTest: true });
    const of = (j: string) => r.results.find((x) => x.jobId === j);
    expect(of(J_IH_BROKEN)).toMatchObject({ outcome: "skipped", message: "in-house job — install form is made from the job" });
    expect(piisaNoAssignee).not.toContain(J_IH_BROKEN);
    expect(of(J_OWN)).toMatchObject({ outcome: "created" });
    expect(piisaNoAssignee).toEqual([J_OWN]);
  });
});

// Runs last: it gives J_IH_BROKEN its Lead Installer (the auto-send test above needs it without a form).
describe("Task 4b carried minors: the held form's office row clears itself", () => {
  test("once the Lead Installer is chosen, the next pass creates the form and records ONE recovered row; later passes add none", async () => {
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'visit_allocated','allocated',$2,true)", [J_IH_BROKEN, JSON.stringify({ visit: "install", worker_id: LEAD })]);
    FORCED_FAILURES = [];
    try { await prestart.sweepPrestart(NOW); await prestart.sweepPrestart(NOW); } finally { FORCED_FAILURES = null; }
    expect(piisaCreates.filter((j) => j === J_IH_BROKEN)).toHaveLength(1);
    const recovered = (await eventsOf(J_IH_BROKEN, "in_house_form_sync_recovered")).filter((e) => e.details?.["reason"] === "Install form created");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.internal).toBe(true);
    // No failure row is left open: the newest failure has a later recovered row.
    expect(await eventsOf(J_IH_BROKEN, "in_house_form_sync_failed")).toHaveLength(2);
  });
  test("an in-house job that never failed gets no recovered row; a non-in-house job never does", async () => {
    expect(await eventsOf(J_IH_RUN, "in_house_form_sync_recovered")).toEqual([]);
    FORCED_FAILURES = [];
    try { await prestart.runPrestart(J_OWN, "office", NOW); } finally { FORCED_FAILURES = null; }
    expect(await eventsOf(J_OWN, "in_house_form_sync_recovered")).toEqual([]);
  });
  test("a partner read failure on a pass is not an office row (the next pass retries)", async () => {
    PARTNER_READ_FAILS.add(J_OWN);
    FORCED_FAILURES = [];
    try { await prestart.runPrestart(J_OWN, "office", NOW); } finally { FORCED_FAILURES = null; PARTNER_READ_FAILS.delete(J_OWN); }
    expect(await eventsOf(J_OWN, "in_house_form_sync_failed")).toEqual([]);
  });
});
