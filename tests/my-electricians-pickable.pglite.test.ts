// Part 2b Task 5: an approved, linked, installer-added electrician is pickable on the installer's OWN jobs — at Add a job
// and in the job-page swap — with no PIESA rate needed (the installer pays its own electricians). A waiting one is not.
// Real Part 2b server code and real rows in PGlite; the sign-in lookup, storage, senders, the Mitti hook and the
// approved-REC read (its PostgREST `or(... cs ...)` filter has no shim) are stubbed at their seams.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key default gen_random_uuid(), business_type text, capabilities jsonb default '[]', name text, trading_name text, email text, phone text, rec_number text,
  onboarding_status text not null default 'draft' CHECK (onboarding_status IN ('draft','submitted','needs_info','approved','suspended','expired')), is_active boolean, public_liability_cover_amount numeric,
  approved_by uuid, approved_at timestamptz, updated_at timestamptz, added_by_installer_business_id uuid references businesses(id), workcover_exempt_declared_at timestamptz, installer_added_rejected_reason text, onboarding_notes text, mitti_account_invited boolean default false);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, trade_role text, full_legal_name text, email text, mobile text, rec_number text, licence_number text, licence_expires_on date, approval_status text, added_by uuid, removed_at timestamptz, approved_by uuid, approved_at timestamptz, rejection_reason text, created_at timestamptz default clock_timestamp());
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, number text, expires_at date, document_path text, verification text not null default 'pending' CHECK (verification IN ('pending','verified','rejected')), critical boolean, created_by uuid, verified_by uuid, verified_at timestamptz, created_at timestamptz default now());
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid not null, electrician_business_id uuid not null, active boolean not null default true, preferred boolean default false, is_primary boolean default false, source text, notes text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
CREATE TABLE sms_messages (id uuid primary key default gen_random_uuid(), message_type text, idempotency_key text, business_id uuid, job_id uuid, status text, created_at timestamptz default now());
CREATE TABLE electrician_rates (id uuid primary key default gen_random_uuid(), business_id uuid, service_type text, rate_inc_gst numeric, status text, effective_from date, effective_to date);
CREATE TABLE owners (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text);
CREATE TABLE properties (id uuid primary key default gen_random_uuid(), owner_id uuid, address_line text, suburb text, postcode text, state text);
CREATE SEQUENCE job_no;
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), job_number text default 'HV-' || nextval('job_no'), owner_id uuid, property_id uuid, stage text, source text, business_unit text, installer_led boolean, channel text,
  originating_installer_business_id uuid, originating_installer_user_id uuid, external_enquiry_id text, customer_relationship_owner text, installer_site_check text, installer_site_check_date date, installer_quoted text, next_action text,
  electrician_choice text, deleted_at timestamptz, last_activity_at timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, assigned_by uuid, first_response_at timestamptz, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp(), ended_at timestamptz, end_reason text);
CREATE TABLE electrician_nominations (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, nominating_business_id uuid, nominated_by uuid, nominated_for text, contact_name text, business_name text, email text, phone text, status text, created_at timestamptz default clock_timestamp(), updated_at timestamptz, ended_at timestamptz);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, from_stage text, to_stage text, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, owner_id uuid, source text, consent_key text, consent_status text, contact_consent boolean, consented_at timestamptz, snapshot jsonb, sha256 text);
CREATE TABLE workflow_settings (id int primary key, mitti_ready_check_priced_template_id text, auto_send_mitti boolean);
INSERT INTO workflow_settings VALUES (1, 'tpl', true);
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, external_source text, external_id text, status text, is_current boolean);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, business_id uuid);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE profiles (id uuid primary key, full_name text, email text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), U_BOSS = id(11), OFFICE = id(50), USUAL = id(60), U_USUAL = id(61);
await db.query(`insert into businesses (id, business_type, name, email, onboarding_status, is_active, capabilities) values ($1,'eec_installer','Insul One','office@insulone.test','approved',true,'[]')`, [INST]);
// An HIV-onboarded REC the installer saved as its usual electrician in My business (has a portal login, like every signed-up REC).
await db.query(`insert into businesses (id, business_type, name, trading_name, rec_number, onboarding_status, is_active, capabilities) values ($1,'rec','Usual Volts Pty Ltd','Usual Volts','REC1000','approved',true,'["electrician"]')`, [USUAL]);
await db.query(`insert into partner_workers (business_id, profile_id, trade_role, full_legal_name, email, licence_number, licence_expires_on, approval_status) values ($1,$2,'electrician','Ursula Usual','ursula@volts.test','L-1000','2099-01-01','approved')`, [USUAL, U_USUAL]);
await db.query(`insert into partner_relationships (installer_business_id, electrician_business_id, active, source) values ($1,$2,true,'office')`, [INST, USUAL]);
await db.query(`insert into admin_config_events (actor_id, event_type, summary, details) values ($1,'installer_usual_electrician_saved','usual',$2)`, [U_BOSS, JSON.stringify({ business_id: INST, electrician: { name: "Usual Volts", licence: "L-1000", priceIncGst: 0 } })]);

const people: Record<string, { biz: string; kind: string; boss: boolean }> = { [U_BOSS]: { biz: INST, kind: "installer", boss: true } };
const WorkflowErr = class extends Error {};
const realWf = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWf, WorkflowError: WorkflowErr }));
mock.module("../src/lib/trade-view.server", () => ({
  bossOrThrow: async (u: string) => { const p = people[u]; if (!p) throw new WorkflowErr("Your sign-in isn't linked to an approved business yet."); return { biz: { id: p.biz, onboarding_notes: null }, kind: p.kind, boss: true }; },
  tradeSetReadyCheckTime: async () => { throw new Error("not used"); },
}));
const storage = { from: () => ({ createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `https://s.test/${p}`, token: "t" }, error: null }) }) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...postgrestShim(db), storage } }));
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => undefined }));
mock.module("../src/lib/sms.server", () => ({ smsHoldReason: async () => null, sendRealSms: async (i: { type: string; idempotencyKey: string; businessId: string | null; jobId: string | null }) => { await db.query("insert into sms_messages (message_type, idempotency_key, business_id, job_id, status) values ($1,$2,$3,$4,'blocked')", [i.type, `${i.idempotencyKey}#held`, i.businessId, i.jobId]); return { status: "blocked", detail: "wording not approved", sid: null }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async () => ({ channel: "email", status: "sent", detail: "" }) }));
mock.module("../src/lib/mitti-invite.server", () => ({ onPartnerPersonApproved: async () => undefined, onPartnerPersonRemoved: async () => undefined }));
mock.module("../src/lib/worker-approval.server", () => ({ approvePartnerWorker: async (workerId: string, actorId: string) => { await db.query("update partner_workers set approval_status='approved', approved_by=$2, approved_at=now() where id=$1", [workerId, actorId]); return true; } }));
// The approved-REC read, from the same rows (the real read's `or(business_type.eq.rec,capabilities.cs.{electrician})` has no shim).
const realRec = await import("../src/lib/rec-onboarded.server");
mock.module("../src/lib/rec-onboarded.server", () => ({ ...realRec, loadApprovedRecCandidates: async () => {
  const bz = (await db.query<{ id: string; name: string; trading_name: string | null; rec_number: string | null; onboarding_status: string; is_active: boolean | null }>("select id, name, trading_name, rec_number, onboarding_status, is_active from businesses where business_type='rec'")).rows;
  const ws = (await db.query<{ business_id: string; licence_number: string | null }>("select business_id, licence_number from partner_workers where trade_role='electrician' and approval_status='approved' and removed_at is null")).rows;
  return bz.map((b) => ({ business_id: b.id, name: b.name, trading_name: b.trading_name, rec_number: b.rec_number, onboarding_status: b.onboarding_status, is_active: b.is_active, worker_licences: ws.filter((w) => w.business_id === b.id).map((w) => w.licence_number), approved_electricians: ws.filter((w) => w.business_id === b.id).length, piesa_rate: null }));
} }));
// Add a job seams: membership, approved partner, duplicate address, the Mitti form creation and the in-house hold.
mock.module("../src/lib/pilot.server", () => ({ requireMember: async () => undefined, requireApprovedPartner: async () => undefined, intakeSourceFor: async () => "real", myBusinesses: async () => [{ business_id: INST, member_role: "business_admin", active: true }] }));
mock.module("../src/lib/duplicate-address.server", () => ({ findOpenJobAtAddress: async () => null, flagDuplicateAddress: async () => undefined, businessNameFor: async () => "Insul One" }));
mock.module("../src/lib/mitti-create.server", () => ({ onReadyCheckJobAdded: async () => "skipped", scheduleReadyCheckFormCreation: async () => undefined }));
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({ ...realSuppression, readInHouseDispatchState: async () => ({ held: new Set(), failed: false }), inHouseDispatchSkip: async () => null }));
mock.module("../src/lib/repeat-piesa.server", () => ({ latestReopenAt: async () => null }));
// The installer pays its own electricians (Reinsulate-style flat PIESA line), so no REC rate is needed anywhere.
const realPaid = await import("../src/lib/installer-paid-electricians.server");
mock.module("../src/lib/installer-paid-electricians.server", () => ({ ...realPaid, readInstallerPaidElectricians: async () => ({ businessId: INST, name: "Insul One", piesaIncGst: 350 }), installerSafetyCheckPrice: async () => 350 }));

const els = await import("../src/lib/my-electricians.server");
const core = await import("../src/lib/electrician-choice.core");
const swap = await import("../src/lib/electrician-swap.server");
const onsite = await import("../src/lib/onsite-ready-check.server");

const P1 = `partners/${INST}/electrician-uploads`;
const input = (o: Record<string, unknown> = {}) => ({
  name: "Sam Sparks", email: "sam@sparks.test", mobile: "0400111222", recNumber: "REC5555", licenceNumber: "L-5555", licenceExpiry: "2099-01-01",
  licenceFilePath: `${P1}/a-licence.jpg`, plFilePath: `${P1}/b-pl.pdf`, plAmount: 5_000_000, plExpiry: "2099-01-01", employsAnyone: false, soleTraderTick: true, ...o,
}) as Parameters<typeof els.installerAddElectrician>[1];
const reject = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e.message));
const owner = { full_name: "Olive Owner", address_line: "1 Example St", suburb: "Clayton", postcode: "3168", phone: "0403595088", email: "olive@owner.test", contact_permission: true, consent_by: "installer" as const };

const { businessId: SAM } = await els.installerAddElectrician(U_BOSS, input());
const { businessId: WAITING } = await els.installerAddElectrician(U_BOSS, input({ name: "Wendy Waiting", email: "wendy@wait.test", mobile: "0433444555", licenceNumber: "L-9999" }));
await els.officeApproveInstallerElectrician(OFFICE, SAM);

describe("pure: the Add a job pick", () => {
  const list = [{ businessId: SAM, name: "Sam Sparks", usual: false }, { businessId: USUAL, name: "Usual Volts", usual: true }];
  test("options: the usual electrician first with the old label, the rest by name; usual preselected", () => {
    expect(core.addJobElectricianOptions(list)).toEqual([{ businessId: USUAL, label: "My usual electrician (Usual Volts)" }, { businessId: SAM, label: "Sam Sparks" }]);
    expect(core.defaultAddJobElectrician(list)).toBe(USUAL);
    expect(core.defaultAddJobElectrician([list[0]!])).toBeNull();
  });
  test("problems: nobody to pick, nothing picked, not on the list", () => {
    expect(core.addJobPickProblem(SAM, [])).toBe(core.ELECTRICIAN_CHOICE_ISSUES.usual);
    expect(core.addJobPickProblem(null, list)).toBe(core.ELECTRICIAN_CHOICE_ISSUES.missing);
    expect(core.addJobPickProblem(WAITING, list)).toBe("That electrician isn't on your list.");
    expect(core.addJobPickProblem(SAM, list)).toBeNull();
  });
});

describe("pickableOwnElectricians", () => {
  test("approved + linked + in date = pickable (no rate needed); the usual one is marked; waiting one is not listed", async () => {
    const list = await els.pickableOwnElectricians(INST);
    expect(list.map((e) => [e.name, e.usual])).toEqual([["Usual Volts", true], ["Sam Sparks", false]]);
    expect(list.map((e) => e.businessId)).not.toContain(WAITING);
  });
  test("a lapsed business document (licence, for an installer-added electrician) drops them from the list", async () => {
    await db.query("update business_credentials set expires_at='2020-01-01' where business_id=$1 and kind='electrical_licence'", [SAM]);
    expect((await els.pickableOwnElectricians(INST)).map((e) => e.businessId)).toEqual([USUAL]);
    await db.query("update business_credentials set expires_at='2099-01-01' where business_id=$1 and kind='electrical_licence'", [SAM]);
  });
  test("a link the office switched off drops them", async () => {
    await db.query("update partner_relationships set active=false where electrician_business_id=$1", [SAM]);
    expect((await els.pickableOwnElectricians(INST)).map((e) => e.businessId)).toEqual([USUAL]);
    await db.query("update partner_relationships set active=true where electrician_business_id=$1", [SAM]);
  });
});

describe("Add a job", () => {
  test("options read: every pickable electrician plus the usual-electrician status the form showed before", async () => {
    const { addJobElectricianChoices } = await import("../src/lib/onsite-ready-check.server");
    const o = await addJobElectricianChoices(INST);
    expect(o.usualElectrician).toEqual({ name: "Usual Volts", onboarded: true });
    expect(o.electricians.map((e) => e.businessId)).toEqual([USUAL, SAM]);
  });
  test("the installer-added electrician can be chosen: nomination + choice event name them", async () => {
    const r = await onsite.startOnsiteReadyCheckFor(U_BOSS, INST, owner, { mode: "mine", business_id: SAM }, undefined, { electricianChoice: "usual", leadOrigin: "owner_contacted" });
    const nom = (await db.query<{ business_id: string; ended_at: string | null }>("select business_id, ended_at from electrician_nominations where job_id=$1", [r.jobId])).rows;
    expect(nom).toEqual([{ business_id: SAM, ended_at: null }]);
    const ev = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='electrician_choice_set'", [r.jobId])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toMatchObject({ choice: "usual", usual_name: "Sam Sparks", source: "add_job" });
    const { jobChosenElectrician } = await import("../src/lib/job-electrician.server");
    expect(await jobChosenElectrician(r.jobId)).toBe(SAM);
  });
  test("a waiting electrician, or one not linked, is refused before anything is saved", async () => {
    const before = (await db.query<{ n: string }>("select count(*)::text as n from jobs")).rows[0]!.n;
    expect(await reject(onsite.startOnsiteReadyCheckFor(U_BOSS, INST, { ...owner, address_line: "2 Example St" }, { mode: "mine", business_id: WAITING }, undefined, { electricianChoice: "usual", leadOrigin: "owner_contacted" }))).toBe("That electrician isn't on your list.");
    expect((await db.query<{ n: string }>("select count(*)::text as n from jobs")).rows[0]!.n).toBe(before);
  });
  test("the usual electrician still works as before (no pick sent = the usual one)", async () => {
    const r = await onsite.startOnsiteReadyCheckFor(U_BOSS, INST, { ...owner, address_line: "3 Example St" }, null, undefined, { electricianChoice: "usual", leadOrigin: "owner_contacted" });
    const { jobChosenElectrician } = await import("../src/lib/job-electrician.server");
    expect(await jobChosenElectrician(r.jobId)).toBe(USUAL);
    const ev = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='electrician_choice_set'", [r.jobId])).rows;
    expect(ev[0]!.details).toMatchObject({ choice: "usual", usual_name: "Usual Volts" });
  });
});

describe("job-page swap", () => {
  const JOB = id(500), U_SAM = id(70);
  test("OPEN QUESTION (Task 5 report): an installer-added electrician has no portal profile, so the swap's `eligibility` says not onboarded", async () => {
    // Part 2b creates the electrician person without a profile (they never log in); `job_assignments.user_id` is NOT NULL,
    // so the swap and the own-job hand-over need a profile id. Until that is decided, the approved electrician is linked but
    // not offered in the swap. This test pins the fact; flip it once the decision lands.
    expect(await swap.eligibility(INST, SAM)).toEqual({ linkedActive: true, onboarded: false, userId: null });
    expect(await swap.eligibility(INST, WAITING)).toEqual({ linkedActive: false, onboarded: false, userId: null });
  });
  test("once the approved electrician's person has a profile they are a swap option; the waiting one never is", async () => {
    await db.query("update partner_workers set profile_id=$2 where business_id=$1", [SAM, U_SAM]);
    await db.query("insert into jobs (id, stage, channel, source, originating_installer_business_id) values ($1,'piesa_and_install_window_pending','installer_sourced','real',$2)", [JOB, INST]);
    const opts = await swap.swapOptions(JOB, INST);
    expect(opts.allowed).toBe(true);
    expect(opts.options.map((o) => o.businessId).sort()).toEqual([SAM, USUAL].sort());
    expect(opts.options.map((o) => o.businessId)).not.toContain(WAITING);
    // A lapsed licence drops them from the swap too (ownJobDocsBlocker is wired into eligibility).
    await db.query("update business_credentials set expires_at='2020-01-01' where business_id=$1 and kind='electrical_licence'", [SAM]);
    expect((await swap.swapOptions(JOB, INST)).options.map((o) => o.businessId)).toEqual([USUAL]);
    await db.query("update business_credentials set expires_at='2099-01-01' where business_id=$1 and kind='electrical_licence'", [SAM]);
  });
});
