// Part 3 Task 3 (Jo 3 Nov 2026): the electrician's link after the safety check — enter the upgrades day, do the A4 in Mitti,
// add the Certificate of Electrical Safety — on real rows (PGlite). confirmBooking is stubbed at its seam exactly as the Part 2
// test does (it writes the booking, moves the stage and calls the A4 form creator like the real one); storage is an in-memory
// bucket; coes-check.server (currentCoes / checkCurrentCoes) is the REAL code on a TEST job (stubbed AI verdict, no gateway).
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL, SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } from "../src/lib/fixes-day.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";
import { CERTIFICATE_WRONG_TYPE, UPGRADES_DAY_LINK_CLAIM_EVENT } from "../src/lib/certificate-later.core";
import { stableUuid } from "../src/lib/mitti-create-claim.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text, job_number text);
CREATE VIEW job_overview AS SELECT id, job_number, '1 Example St, Clayton 3168'::text AS property_address, 'Sam Owner'::text AS owner_name, '0400000000'::text AS owner_phone FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, full_legal_name text, mobile text, removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp(), ended_at timestamptz, end_reason text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, business_id uuid, contractor_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
CREATE TABLE contact_releases (id uuid primary key default gen_random_uuid(), job_id uuid, assignment_id uuid, visit_kind text, released_by uuid, owner_notice text, trade_notice text, revoked_at timestamptz, UNIQUE (assignment_id, visit_kind));
CREATE TABLE electrician_job_links (id uuid primary key default gen_random_uuid(), job_id uuid, electrician_business_id uuid, token_hash text unique, created_at timestamptz default now(), expires_at timestamptz, revoked_at timestamptz, revoked_reason text);
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, mitti_raw_snapshot jsonb, completed_at timestamptz);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, outcome text, completed_date date, is_current boolean default true, created_at timestamptz default clock_timestamp());
-- Fix round 3: the live one-current-record-per-job index (drizzle/migrations/0000_hivic_core_schema.sql).
create unique index if not exists piesa_current_uq on piesa_records(job_id) where is_current;
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, gate text, label text, required boolean default false, responsible_role text, status text default 'outstanding', notes text, verified_by uuid, verified_at timestamptz, sort int);
CREATE TABLE evidence_files (id uuid primary key, requirement_id uuid, job_id uuid, storage_path text, file_name text, mime_type text, size_bytes int, uploaded_by uuid, lat double precision, lng double precision, location_accuracy_m double precision, captured_at timestamptz, distance_m double precision, location_source text, uploaded_at timestamptz default clock_timestamp());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, mime_type text, external_id text, source_system text, created_at timestamptz default clock_timestamp());
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, description text, status text);
CREATE TABLE sms_messages (id uuid primary key default gen_random_uuid(), idempotency_key text unique, status text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), U1 = id(11);
const J_DAY = id(201), J_CERT = id(202), J_SAMEDAY = id(203), J_REAL = id(204);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test','0300000000',null), ($2,'Sparky Co','Sparky Co',null,'0411111111',null)`, [INST, ELEC]);
await db.query(`insert into partner_workers (business_id, profile_id, full_legal_name, mobile) values ($1,$2,'Sparky Sam','0411111111')`, [ELEC, U1]);
const label = (fid: string) => SHORT_PIESA_FIELDS.find((f) => f.id === fid)!.label;
const CES_LABEL = PIESA_EVIDENCE_BY_ID.ces_file.label;
const snapshot = (o: { today: "Yes" | "No"; certNow?: "Yes" | "No"; cesMedia?: string[] }) => [
  { label: A3_REPAIR_NEEDED_LABEL, value: "Yes" },
  { label: A3_UPGRADES_TODAY_LABEL, value: o.today },
  ...(o.certNow ? [{ label: CERTIFICATE_NOW_LABEL, value: o.certNow }] : []),
  { label: label("coesNumber"), value: null }, { label: label("certDate"), value: null },
  { label: CES_LABEL, value: null, media: (o.cesMedia ?? []).map((m) => ({ mediaId: m, capturedAt: null, lat: null, lng: null })) },
];
async function seedJob(j: string, stage: string, snap: unknown, opts: { source?: string; record?: boolean; requirement?: boolean } = {}) {
  await db.query("insert into jobs values ($1,$2,null,$3,'installer_sourced',$4,$5)", [j, stage, INST, opts.source ?? "qa_test", `HV-${j.slice(-3)}`]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U1]);
  await db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,'own_job_piesa_handed','handed','{}')", [j]);
  await db.query("insert into assessments (job_id, mitti_raw_snapshot, completed_at) values ($1,$2,now())", [j, JSON.stringify(snap)]);
  if (opts.record !== false) await db.query("insert into piesa_records (job_id, kind, outcome, completed_date) values ($1,'post_rectification','pass','2026-11-03')", [j]);
  if (opts.requirement !== false) await db.query("insert into evidence_requirements (job_id, category, gate, label, required, responsible_role) values ($1,'rectification_completion','electrical','Rectification completion evidence',true,'electrician')", [j]);
}
// J_DAY: PIESA done, upgrades needed on another day, nothing booked yet.
await seedJob(J_DAY, "rectification_scheduling", snapshot({ today: "No" }), { record: false });
await db.query("insert into rectification_items (job_id, description, status) values ($1,'Replace split conduit','required')", [J_DAY]);
// J_CERT: the A4 was completed without the certificate (Part C merged onto the A3 answers, post_rectification record written).
await seedJob(J_CERT, "installation_scheduling", snapshot({ today: "Yes", certNow: "No" }));
// J_SAMEDAY: same-day upgrades on the A3, "have the certificate now?" = No, completed BEFORE Task 4b (no post_rectification
// record; since Task 4b Complete PIESA writes one — tests/piesa-complete-upgrades.pglite.test.ts). Still read from the answers.
await seedJob(J_SAMEDAY, "installation_scheduling", snapshot({ today: "Yes", certNow: "No" }), { record: false, requirement: false });
// J_REAL: a real job for the held text.
await seedJob(J_REAL, "installation_scheduling", snapshot({ today: "Yes", certNow: "No" }), { source: "real" });

// In-memory "job-files" bucket.
const stored = new Map<string, Uint8Array>();
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...Array(40).fill(0x20)]);
const storage = {
  from: (_bucket: string) => ({
    createSignedUploadUrl: async (path: string) => ({ data: { token: `tok:${path}`, signedUrl: `https://bucket.test/${path}` }, error: null }),
    list: async (folder: string, o?: { search?: string }) => ({ data: [...stored.keys()].filter((p) => p.startsWith(`${folder}/`) && (!o?.search || p.includes(o.search))).map((p) => ({ name: p.slice(folder.length + 1), metadata: { size: stored.get(p)!.length, mimetype: "application/pdf" } })), error: null }),
    download: async (path: string) => { const b = stored.get(path); return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "not found" } }; },
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://bucket.test/${path}` }, error: null }),
    remove: async (paths: string[]) => { for (const p of paths) stored.delete(p); return { data: null, error: null }; },
  }),
};
// Task 4: a hook to hold a workflow_events delete (forces the "two taps after a stale claim" interleaving).
let holdEventDelete: ((n: number) => Promise<void>) | null = null;
let eventDeletes = 0;
const shim = postgrestShim(db);
const admin = { ...shim, storage, from(table: string) {
  const b = shim.from(table) as ReturnType<typeof shim.from> & { delete: () => unknown; run: () => Promise<unknown> };
  if (table !== "workflow_events") return b;
  const del = b.delete.bind(b), run = b.run.bind(b);
  let isDelete = false;
  b.delete = () => { isDelete = true; return del(); };
  b.run = async () => { if (isDelete && holdEventDelete) await holdEventDelete(++eventDeletes); return run(); };
  return b;
} };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/upload-safety.server", () => ({
  BAD_FILE_MESSAGE: "bad file", CHECK_UNAVAILABLE_MESSAGE: "unavailable",
  verifyStoredUpload: async (_b: string, path: string) => { const bytes = stored.get(path); if (!bytes) throw new Error("unavailable"); if (bytes[0] !== 0x25) { stored.delete(path); throw new Error("bad file"); } },
}));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true, assertCustomerDeliveryAllowed: async () => undefined }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  getStage: async (job: string) => (await db.query<{ stage: string }>("select stage from jobs where id=$1", [job])).rows[0]!.stage,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]);
  },
}));
const a4Calls: string[] = [];
const realFixes = await import("../src/lib/fixes-day.server");
mock.module("../src/lib/fixes-day.server", () => ({ ...realFixes, onRectificationBooked: async (job: string) => { a4Calls.push(job); return { status: "created" }; } }));
const realBooking = await import("../src/lib/booking.server");
mock.module("../src/lib/booking.server", () => ({
  ...realBooking,
  confirmBooking: async (job: string, kind: string, start: string, actor: string) => {
    if (kind !== "rectification") throw new Error(`unexpected booking kind ${kind}`);
    await new Promise((r) => setTimeout(r, 20)); // a slow booking, so two taps overlap
    const stage = (await db.query<{ stage: string }>("select stage from jobs where id=$1", [job])).rows[0]!.stage;
    if (!["rectification_scheduling", "rectification_booked"].includes(stage)) throw new Error(`A rectification booking can't be made at ${stage}.`);
    const a = (await db.query<{ id: string; business_id: string }>("select id, business_id from job_assignments where job_id=$1 and role='electrician' and active", [job])).rows[0]!;
    await db.query("update bookings set status='cancelled' where job_id=$1 and kind='rectification' and status in ('proposed','confirmed')", [job]);
    const ins = await db.query<{ id: string }>("insert into bookings (job_id, kind, status, scheduled_start, business_id, contractor_id) values ($1,$2,'confirmed',$3,$4,$5) returning id", [job, kind, start, a.business_id, actor]);
    await db.query("update jobs set stage='rectification_booked' where id=$1", [job]);
    // The real confirmBooking (decision 293) makes the A4 form for a booked upgrades visit.
    await (await import("../src/lib/fixes-day.server")).onRectificationBooked(job, ins.rows[0]!.id, actor);
  },
}));
const ownerNotices: string[] = [];
const realInHouse = await import("../src/lib/in-house-booking.server");
mock.module("../src/lib/in-house-booking.server", () => ({ ...realInHouse, notifyOwnerBooked: async (job: string, kind: string) => { ownerNotices.push(`${job}:${kind}`); return "held: wording not approved"; } }));
const ownerCopies: string[] = [];
mock.module("../src/lib/coes-owner-copy.server", () => ({ sendCoesOwnerCopy: async (job: string, ref: { key: string }) => { ownerCopies.push(`${job}:${ref.key}`); return "held"; } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const realSms: { type: string; key: string; body: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  smsHoldReason: async (i: { type: string }) => (i.type === "electrician_certificate_link" ? "wording not approved" : null),
  sendRealSms: async (i: { type: string; idempotencyKey: string; body: string }) => { realSms.push({ type: i.type, key: i.idempotencyKey, body: i.body }); return { status: "sent" }; },
}));
const testSms: { to: string; body: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ sendTestSms: async (_c: unknown, to: string, body: string) => { testSms.push({ to, body }); return { status: "sent" }; } }));

const els = await import("../src/lib/electrician-link.server");
const cls = await import("../src/lib/certificate-later.server");
const coes = await import("../src/lib/coes-check.server");
const notices = await import("../src/lib/own-job-piesa-notices.server");
const tokenFor = async (job: string, biz = ELEC) => new URL((await els.createElectricianJobLink(job, biz)).url, "https://x.test").pathname.replace("/e/", "");
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const events = async (job: string, type: string) => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [job, type])).rows;

describe("enter the upgrades day", () => {
  test("the link shows 'enter the upgrades day' and the status line says the day isn't set", async () => {
    const t = await tokenFor(J_DAY);
    expect(await els.resolveElectricianLink(t)).toMatchObject({ ok: true, step: "enter_upgrades_day" });
    const v = await els.electricianLinkView(t);
    expect(v).toMatchObject({ ok: true, step: "enter_upgrades_day", ownerName: null, ownerMobile: null, electricianName: "Sparky Sam" });
    const f = await cls.jobCertificateFacts(J_DAY);
    expect(f).toMatchObject({ upgradesNeeded: true, upgradesDaySet: false, partCRecorded: false, state: "upgrades_pending", line: "Upgrades day not set yet", electrician: "Sparky Sam" });
  });
  test("a past day is refused; a good day books the upgrades visit, makes the A4 form, tells the owner (held), and a double tap books once", async () => {
    const t = await tokenFor(J_DAY);
    await expect(els.linkEnterUpgradesDay(t, soon(-1))).rejects.toThrow("already passed");
    expect((await db.query("select * from bookings where job_id=$1", [J_DAY])).rows).toHaveLength(0);
    const r = await Promise.allSettled([els.linkEnterUpgradesDay(t, soon(5)), els.linkEnterUpgradesDay(t, soon(5))]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message)).toContain("already set");
    const b = (await db.query<{ kind: string; status: string }>("select kind, status from bookings where job_id=$1", [J_DAY])).rows;
    expect(b).toEqual([{ kind: "rectification", status: "confirmed" }]);
    expect((await db.query<{ stage: string }>("select stage from jobs where id=$1", [J_DAY])).rows[0]!.stage).toBe("rectification_booked");
    expect(a4Calls).toEqual([J_DAY]);
    expect(ownerNotices).toEqual([`${J_DAY}:upgrades`]);
    const v = await els.electricianLinkView(t);
    expect(v).toMatchObject({ ok: true, step: "do_upgrades_in_mitti" });
    expect(Date.parse((v as { upgradesStart: string }).upgradesStart)).toBeGreaterThan(Date.now());
    await expect(els.linkEnterUpgradesDay(t, soon(6))).rejects.toThrow("already set");
    expect((await cls.jobCertificateFacts(J_DAY)).line).toBeNull(); // day set: no "not set" line
  });
  test("fix round 1: a stale claim (crash between the claim and the booking) is reset; an in-flight one is 'already set'", async () => {
    const J = id(208);
    await seedJob(J, "rectification_scheduling", snapshot({ today: "No" }), { record: false });
    const asg = (await db.query<{ id: string }>("select id from job_assignments where job_id=$1", [J])).rows[0]!.id;
    const claimId = await stableUuid(`${UPGRADES_DAY_LINK_CLAIM_EVENT}:${asg}:none`);
    // A fresh claim with no booking = a second tap still in flight: refused, left alone.
    await db.query("insert into workflow_events (id, job_id, event_type, summary, details, internal) values ($1,$2,$3,'claim','{}',true)", [claimId, J, UPGRADES_DAY_LINK_CLAIM_EVENT]);
    const t = await tokenFor(J);
    await expect(els.linkEnterUpgradesDay(t, soon(5))).rejects.toThrow("already set");
    expect((await db.query("select * from bookings where job_id=$1", [J])).rows).toHaveLength(0);
    // The same claim ten minutes old with still no booking = stale: reset, logged on the new claim, and the day is booked.
    await db.query("update workflow_events set created_at = now() - interval '10 minutes' where id=$1", [claimId]);
    await els.linkEnterUpgradesDay(t, soon(5));
    expect((await db.query("select * from bookings where job_id=$1 and kind='rectification' and status='confirmed'", [J])).rows).toHaveLength(1);
    const claims = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2", [J, UPGRADES_DAY_LINK_CLAIM_EVENT])).rows;
    expect(claims).toHaveLength(1);
    expect(claims[0]!.details["stale_claim_reset"]).toBe(true);
    // Booked now: an old-looking claim is never reset again.
    await db.query("update workflow_events set created_at = now() - interval '10 minutes' where id=$1", [claimId]);
    await expect(els.linkEnterUpgradesDay(t, soon(6))).rejects.toThrow("already set");
    expect((await db.query("select * from bookings where job_id=$1 and kind='rectification' and status='confirmed'", [J])).rows).toHaveLength(1);
  });
  test("Task 4 carried item: two taps after a stale claim book once (the reset delete is conditional)", async () => {
    const J = id(209);
    await seedJob(J, "rectification_scheduling", snapshot({ today: "No" }), { record: false });
    const asg = (await db.query<{ id: string }>("select id from job_assignments where job_id=$1", [J])).rows[0]!.id;
    const claimId = await stableUuid(`${UPGRADES_DAY_LINK_CLAIM_EVENT}:${asg}:none`);
    await db.query("insert into workflow_events (id, job_id, event_type, summary, details, internal, created_at) values ($1,$2,$3,'claim','{}',true, now() - interval '10 minutes')", [claimId, J, UPGRADES_DAY_LINK_CLAIM_EVENT]);
    const t = await tokenFor(J);
    // Both taps read the stale claim; the second tap's reset delete runs only after the first tap re-claimed.
    eventDeletes = 0;
    holdEventDelete = async (n) => { if (n <= 2) await new Promise((r) => setTimeout(r, n === 1 ? 30 : 60)); };
    const r = await Promise.allSettled([els.linkEnterUpgradesDay(t, soon(5)), els.linkEnterUpgradesDay(t, soon(5))]).finally(() => { holdEventDelete = null; });
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message)).toContain("already set");
    expect((await db.query("select * from bookings where job_id=$1 and kind='rectification'", [J])).rows).toHaveLength(1);
    const claims = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2", [J, UPGRADES_DAY_LINK_CLAIM_EVENT])).rows;
    expect(claims).toHaveLength(1);
  });
  test("a revoked link can't enter a day", async () => {
    const J = id(205);
    await seedJob(J, "rectification_scheduling", snapshot({ today: "No" }), { record: false });
    const t = await tokenFor(J);
    await els.revokeElectricianLinks(J, "reassigned");
    await expect(els.linkEnterUpgradesDay(t, soon(5))).rejects.toThrow("moved to another electrician");
    expect((await db.query("select * from bookings where job_id=$1", [J])).rows).toHaveLength(0);
  });
});

describe("add the certificate", () => {
  test("Part C recorded without a certificate → 'Waiting for certificate', link step add_certificate, no owner contacts", async () => {
    const f = await cls.jobCertificateFacts(J_CERT);
    expect(f).toMatchObject({ upgradesNeeded: true, partCRecorded: true, certificateFileAt: null, state: "waiting_for_certificate", line: "Waiting for Sparky Sam's Certificate of Electrical Safety" });
    expect(f.upgradesDoneAt).toBe("2026-11-03");
    expect(ownerCopies.filter((x) => x.startsWith(J_CERT))).toHaveLength(0);
    const t = await tokenFor(J_CERT);
    expect(await els.electricianLinkView(t)).toMatchObject({ ok: true, step: "add_certificate", ownerName: null, ownerMobile: null });
    expect(await coes.currentCoes(J_CERT)).toMatchObject({ needed: true, ref: { files: [] } });
  });
  test("the upload URL is minted only for a valid link, under the job's electrician-uploads folder", async () => {
    const t = await tokenFor(J_CERT);
    const u = await els.linkStartCertificateUpload(t, { fileName: "coes.pdf", mime: "application/pdf", size: 1000 });
    expect(u.path.startsWith(`jobs/${J_CERT}/electrician-uploads/`)).toBe(true);
    expect(u.path).toEndWith(".pdf");
    await expect(els.linkStartCertificateUpload("nope", { fileName: "coes.pdf", mime: "application/pdf", size: 1000 })).rejects.toThrow();
    await expect(els.linkStartCertificateUpload(t, { fileName: "coes.exe", mime: "application/octet-stream", size: 1000 })).rejects.toThrow();
    // Fix round 1: only PDF / JPG / PNG (what the owner's copy can carry), with a plain message.
    await expect(els.linkStartCertificateUpload(t, { fileName: "coes.heic", mime: "image/heic", size: 1000 })).rejects.toThrow(CERTIFICATE_WRONG_TYPE);
    await expect(els.linkStartCertificateUpload(t, { fileName: "coes.webp", mime: "image/webp", size: 1000 })).rejects.toThrow(CERTIFICATE_WRONG_TYPE);
    await expect(els.linkStartCertificateUpload(t, { fileName: "coes.pdf", mime: "application/pdf", size: 30 * 1024 * 1024 })).rejects.toThrow("25 MB");
  });
  test("add it: the file lands where coes-check reads it (one check, one owner copy), the number/date land on Part C, the state clears", async () => {
    const t = await tokenFor(J_CERT);
    const u = await els.linkStartCertificateUpload(t, { fileName: "coes.pdf", mime: "application/pdf", size: PDF.length });
    // Not uploaded yet → refused, nothing recorded.
    await expect(els.linkAddCertificate(t, { number: "C123", date: "2026-11-03", filePath: u.path, fileName: "coes.pdf" })).rejects.toThrow();
    stored.set(u.path, PDF);
    await expect(els.linkAddCertificate(t, { number: "C123", date: "2099-01-01", filePath: u.path, fileName: "coes.pdf" })).rejects.toThrow("future");
    await expect(els.linkAddCertificate(t, { number: "C123", date: "2026-11-03", filePath: `jobs/${J_DAY}/electrician-uploads/x.pdf`, fileName: "coes.pdf" })).rejects.toThrow();
    expect((await db.query("select * from evidence_files where job_id=$1", [J_CERT])).rows).toHaveLength(0);
    const r = await Promise.allSettled([
      els.linkAddCertificate(t, { number: "C123", date: "2026-11-03", filePath: u.path, fileName: "coes.pdf" }),
      els.linkAddCertificate(t, { number: "C123", date: "2026-11-03", filePath: u.path, fileName: "coes.pdf" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const ev = (await db.query<{ storage_path: string; mime_type: string }>("select storage_path, mime_type from evidence_files where job_id=$1", [J_CERT])).rows;
    expect(ev).toEqual([{ storage_path: u.path, mime_type: "application/pdf" }]);
    expect((await db.query<{ status: string }>("select status from evidence_requirements where job_id=$1 and category='rectification_completion'", [J_CERT])).rows[0]!.status).toBe("uploaded");
    // One post_rectification record (the A4's) — the link never writes a second one.
    expect((await db.query("select * from piesa_records where job_id=$1 and kind='post_rectification'", [J_CERT])).rows).toHaveLength(1);
    // Part C number/date on the stored PIESA answers.
    const snap = (await db.query<{ mitti_raw_snapshot: { label: string; value: string | null }[] }>("select mitti_raw_snapshot from assessments where job_id=$1", [J_CERT])).rows[0]!.mitti_raw_snapshot;
    expect(snap.find((e) => e.label === label("coesNumber"))?.value).toBe("C123");
    expect(snap.find((e) => e.label === label("certDate"))?.value).toBe("2026-11-03");
    // coes-check sees it as the current certificate (source portal), checked once (TEST stub ticks), one owner copy.
    const c = await coes.currentCoes(J_CERT);
    expect(c).toMatchObject({ needed: true, source: "portal" });
    expect(c.ref!.files).toHaveLength(1);
    const checked = await events(J_CERT, "coes_checked");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.details["key"]).toBe(c.ref!.key);
    expect(ownerCopies).toEqual([`${J_CERT}:${c.ref!.key}`]);
    expect(await events(J_CERT, "certificate_added_by_link")).toHaveLength(1);
    const f = await cls.jobCertificateFacts(J_CERT);
    expect(f).toMatchObject({ state: "clear", line: null, certificateTicked: true });
    expect(f.certificateFileAt).not.toBeNull();
    expect(await els.resolveElectricianLink(t)).toMatchObject({ ok: true, step: "done" });
    await expect(els.linkAddCertificate(t, { number: "C123", date: "2026-11-03", filePath: u.path, fileName: "coes.pdf" })).rejects.toThrow("already");
  });
  test("Review Focus 2: a later Mitti q45 on the same job → still ONE current certificate and ONE check event", async () => {
    // The electrician also attaches the certificate in Mitti afterwards: q45 media + the filed document.
    await db.query("insert into documents (job_id, kind, title, storage_path, mime_type, external_id, source_system) values ($1,$2,$3,$4,'application/pdf',$5,'mitti')", [J_CERT, FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE, `${J_CERT}/mitti/m1.pdf`, `audit:m1`]);
    stored.set(`${J_CERT}/mitti/m1.pdf`, PDF);
    const snap = (await db.query<{ mitti_raw_snapshot: { label: string; value: string | null; media?: unknown[] }[] }>("select mitti_raw_snapshot from assessments where job_id=$1", [J_CERT])).rows[0]!.mitti_raw_snapshot;
    for (const e of snap) if (e.label === CES_LABEL) e.media = [{ mediaId: "m1", capturedAt: null, lat: null, lng: null }];
    await db.query("update assessments set mitti_raw_snapshot=$2 where job_id=$1", [J_CERT, JSON.stringify(snap)]);
    const c = await coes.currentCoes(J_CERT);
    expect(c.source).toBe("portal"); // the certificate that came first stays current
    expect(c.ref!.files).toHaveLength(1);
    expect(await coes.checkCurrentCoes(J_CERT, null)).toBe("already checked");
    expect(await events(J_CERT, "coes_checked")).toHaveLength(1);
    // The owner copy is keyed per certificate (sendCoesOwnerCopy dedupes by key): every call names the ONE certificate.
    expect(new Set(ownerCopies.filter((x) => x.startsWith(J_CERT))).size).toBe(1);
  });
  test("same-day upgrades on an A3 completed before Task 4b (no post_rectification record): waiting, then the link's certificate is seen", async () => {
    expect(await cls.jobCertificateFacts(J_SAMEDAY)).toMatchObject({ partCRecorded: true, state: "waiting_for_certificate" });
    const t = await tokenFor(J_SAMEDAY);
    expect(await els.resolveElectricianLink(t)).toMatchObject({ ok: true, step: "add_certificate" });
    const u = await els.linkStartCertificateUpload(t, { fileName: "cert.pdf", mime: "application/pdf", size: PDF.length });
    stored.set(u.path, PDF);
    await els.linkAddCertificate(t, { number: "C555", date: "2026-11-02", filePath: u.path, fileName: "cert.pdf" });
    // The requirement row was missing on this job: made on the way, once.
    expect((await db.query("select * from evidence_requirements where job_id=$1 and category='rectification_completion'", [J_SAMEDAY])).rows).toHaveLength(1);
    expect(await coes.currentCoes(J_SAMEDAY)).toMatchObject({ needed: true, source: "portal" });
    expect((await cls.jobCertificateFacts(J_SAMEDAY)).state).toBe("clear");
    expect(await els.resolveElectricianLink(t)).toMatchObject({ ok: true, step: "done" });
  });
  test("fix round 1: the office rejects the certificate → waiting again, the link says why and takes a new one, which is checked", async () => {
    const before = await cls.jobCertificateFacts(J_SAMEDAY);
    expect(before.state).toBe("clear");
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'coes_rejected','rejected',$2,true)", [J_SAMEDAY, JSON.stringify({ by: "office", note: "Wrong address on it", key: before.certificateKey })]);
    const f = await cls.jobCertificateFacts(J_SAMEDAY);
    expect(f).toMatchObject({ state: "waiting_for_certificate", certificateRejectedWhy: "Wrong address on it", line: "Waiting for Sparky Sam's Certificate of Electrical Safety" });
    const t = await tokenFor(J_SAMEDAY);
    const v = await els.electricianLinkView(t);
    expect(v).toMatchObject({ ok: true, step: "add_certificate", certificateRejected: "The office couldn't accept that certificate: Wrong address on it. Add a new one." });
    const u = await els.linkStartCertificateUpload(t, { fileName: "cert2.pdf", mime: "application/pdf", size: PDF.length });
    stored.set(u.path, PDF);
    await els.linkAddCertificate(t, { number: "C556", date: "2026-11-02", filePath: u.path, fileName: "cert2.pdf" });
    const after = await cls.jobCertificateFacts(J_SAMEDAY);
    expect(after.state).toBe("clear"); // the new file set has a new key, checked (TEST stub ticks)
    expect(after.certificateKey).not.toBe(before.certificateKey);
    expect(after.certificateRejectedWhy).toBeNull();
    expect(await events(J_SAMEDAY, "coes_checked")).toHaveLength(2);
    expect(await els.resolveElectricianLink(t)).toMatchObject({ ok: true, step: "done" });
  });
  test("a revoked link can't add a certificate", async () => {
    const J = id(206);
    await seedJob(J, "installation_scheduling", snapshot({ today: "Yes", certNow: "No" }));
    const t = await tokenFor(J);
    const u = await els.linkStartCertificateUpload(t, { fileName: "c.pdf", mime: "application/pdf", size: PDF.length });
    stored.set(u.path, PDF);
    await els.revokeElectricianLinks(J, "cant_do");
    await expect(els.linkAddCertificate(t, { number: "C1", date: "2026-11-01", filePath: u.path, fileName: "c.pdf" })).rejects.toThrow("moved to another electrician");
    expect((await db.query("select * from evidence_files where job_id=$1", [J])).rows).toHaveLength(0);
  });
});

describe("the certificate text", () => {
  test("TEST job: the test sender gets the text with a fresh link, once; nothing once the certificate is in", async () => {
    const J = id(207);
    await seedJob(J, "installation_scheduling", snapshot({ today: "Yes", certNow: "No" }));
    expect(await notices.textCertificateLink(J, "now")).toBe("test_sent");
    expect(testSms).toHaveLength(1);
    expect(testSms[0]!.body).toMatch(/Certificate of Electrical Safety/);
    expect(testSms[0]!.body).toMatch(/\/e\/[A-Za-z0-9_-]{40,}/);
    expect(await notices.textCertificateLink(J, "now")).toBe("already");
    expect(testSms).toHaveLength(1);
    // The certificate is already on J_SAMEDAY: no text.
    expect(await notices.textCertificateLink(J_SAMEDAY, "now")).toBe("not_waiting (clear)");
  });
  test("real job: held while the wording isn't approved — no link minted, one held event, nothing sent", async () => {
    const before = (await db.query("select * from electrician_job_links where job_id=$1", [J_REAL])).rows.length;
    expect(await notices.textCertificateLink(J_REAL, "now")).toBe("held: wording not approved");
    expect(await notices.textCertificateLink(J_REAL, "now")).toBe("held: wording not approved");
    expect((await db.query("select * from electrician_job_links where job_id=$1", [J_REAL])).rows).toHaveLength(before);
    expect(realSms).toHaveLength(0);
    const held = (await db.query<{ summary: string }>("select summary from workflow_events where job_id=$1 and event_type='own_job_piesa_notice_held'", [J_REAL])).rows;
    expect(held).toHaveLength(1);
    expect(held[0]!.summary).toBe("Electrician's certificate text not sent yet: wording not approved");
  });
});
