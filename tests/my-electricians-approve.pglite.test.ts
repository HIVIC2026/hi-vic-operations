// Part 2b Task 4: the office approves or rejects an installer-added electrician; the installer fixes and resubmits (PGlite).
// Real server code; the sign-in lookup, storage, the SMS sender, the office email sender and the Mitti hook are stubbed.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key default gen_random_uuid(), business_type text, capabilities jsonb default '[]', name text, email text, phone text, rec_number text,
  onboarding_status text not null default 'draft' CHECK (onboarding_status IN ('draft','submitted','needs_info','approved','suspended','expired')), is_active boolean, public_liability_cover_amount numeric,
  approved_by uuid, approved_at timestamptz, updated_at timestamptz, added_by_installer_business_id uuid references businesses(id), workcover_exempt_declared_at timestamptz, installer_added_rejected_reason text, onboarding_notes text);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, account_status text not null default 'unlinked', linked_by uuid, linked_at timestamptz, trade_role text, full_legal_name text, email text, mobile text, rec_number text, licence_number text, licence_expires_on date, approval_status text, added_by uuid, removed_at timestamptz, approved_by uuid, approved_at timestamptz, rejection_reason text);
CREATE TABLE profiles (id uuid primary key, email text, full_name text, business_id uuid);
CREATE TABLE user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role text not null, UNIQUE (user_id, role));
CREATE TABLE business_members (id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null, member_role text not null, active boolean not null default true, added_by uuid, UNIQUE (business_id, user_id));
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, number text, expires_at date, document_path text, verification text not null default 'pending' CHECK (verification IN ('pending','verified','rejected')), critical boolean, created_by uuid, verified_by uuid, verified_at timestamptz, created_at timestamptz default now());
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid not null, electrician_business_id uuid not null, active boolean not null default true, preferred boolean default false, is_primary boolean default false, source text, notes text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
CREATE TABLE sms_messages (id uuid primary key default gen_random_uuid(), message_type text, idempotency_key text, business_id uuid, job_id uuid, status text, created_at timestamptz default now());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), INST2 = id(2), U_BOSS = id(11), U_BOSS2 = id(12), OFFICE = id(50);
await db.query(`insert into businesses (id, business_type, name, email, onboarding_status, is_active, capabilities) values ($1,'eec_installer','Insul One','office@insulone.test','approved',true,'[]'), ($2,'eec_installer','Insul Two','office@insultwo.test','approved',true,'[]')`, [INST, INST2]);
const people: Record<string, { biz: string; kind: string; boss: boolean }> = { [U_BOSS]: { biz: INST, kind: "installer", boss: true }, [U_BOSS2]: { biz: INST2, kind: "installer", boss: true } };
const WorkflowErr = class extends Error {};
const realWf = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWf, WorkflowError: WorkflowErr }));
mock.module("../src/lib/trade-view.server", () => ({
  bossOrThrow: async (u: string) => { const p = people[u]; if (!p) throw new WorkflowErr("Your sign-in isn't linked to an approved business yet."); if (!p.boss) throw new WorkflowErr("Only the business owner can see this."); return { biz: { id: p.biz, onboarding_notes: null }, kind: p.kind, boss: true }; },
}));
const storage = { from: () => ({ createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `https://s.test/${p}`, token: "t" }, error: null }) }) };
// The auth admin (PGlite has no auth): createUser mints an id and records every call, so the tests can count sign-ups. It
// sends nothing, like the real one with email_confirm.
const authUsers: { email: string; email_confirm: boolean; full_name: string | null }[] = [];
let authUserN = 0;
const auth = { admin: { createUser: async (u: { email: string; email_confirm?: boolean; password?: string; user_metadata?: { full_name?: string | null } }) => {
  if (authUsers.some((x) => x.email === u.email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
  authUsers.push({ email: u.email, email_confirm: !!u.email_confirm, full_name: u.user_metadata?.full_name ?? null });
  return { data: { user: { id: `70000000-0000-4000-8000-${String(++authUserN).padStart(12, "0")}`, email: u.email } }, error: null };
} } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...postgrestShim(db), storage, auth } }));
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => undefined }));
const smsCalls: { type: string; businessId: string | null; jobId: string | null; to: string | null; body: string; idempotencyKey: string }[] = [];
let smsThrowOnce = false;
// Like the real sender: a held attempt is still RECORDED in sms_messages (the once-only key lives there); a thrown error records nothing.
mock.module("../src/lib/sms.server", () => ({
  smsHoldReason: async () => null,
  sendRealSms: async (i: (typeof smsCalls)[number]) => {
    if (smsThrowOnce) { smsThrowOnce = false; throw new Error("Could not check SMS history safely; nothing sent"); }
    smsCalls.push(i);
    await db.query("insert into sms_messages (message_type, idempotency_key, business_id, job_id, status) values ($1,$2,$3,$4,'blocked')", [i.type, `${i.idempotencyKey}#held:${crypto.randomUUID()}`, i.businessId, i.jobId]);
    return { status: "blocked", detail: "wording not approved", sid: null };
  },
}));
const emails: { to: string; subject: string; message: string; record: unknown; pauseJobId: unknown; recipient: string }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: (typeof emails)[number]) => { emails.push(p); return { channel: "email", to: p.to, status: "sent", detail: "" }; } }));
const mitti: string[] = [];
mock.module("../src/lib/mitti-invite.server", () => ({ onPartnerPersonApproved: async (w: string) => { mitti.push(w); }, onPartnerPersonRemoved: async () => undefined }));
// The person approval (its own behaviour is tested elsewhere): the same columns, the Mitti hook, and a one-shot failure switch for the retry test.
let failWorkerApprovalOnce = false;
mock.module("../src/lib/worker-approval.server", () => ({
  approvePartnerWorker: async (workerId: string, actorId: string, how: { kind: string }) => {
    if (failWorkerApprovalOnce) { failWorkerApprovalOnce = false; throw new Error("database went away"); }
    expect(how.kind).toBe("office");
    await db.query("update partner_workers set approval_status='approved', approved_by=$2, approved_at=now(), rejection_reason=null where id=$1", [workerId, actorId]);
    mitti.push(workerId);
    return true;
  },
}));

const els = await import("../src/lib/my-electricians.server");
const core = await import("../src/lib/my-electricians.core");
const { SMS_FRESHNESS, SMS_MESSAGE_TYPES } = await import("../src/lib/sms.core");
const { BLOCKING_BUSINESS_DOCS, expiredBusinessDocsBlocker } = await import("../src/lib/trade-expiry.core");
const { workerOfferBlocker } = await import("../src/lib/worker-compliance.core");

const P1 = `partners/${INST}/electrician-uploads`;
const input = (o: Record<string, unknown> = {}) => ({
  name: "Sam Sparks", email: "sam@sparks.test", mobile: "0400111222", recNumber: "REC5555", licenceNumber: "L-5555", licenceExpiry: "2099-01-01",
  licenceFilePath: `${P1}/a-licence.jpg`, plFilePath: `${P1}/b-pl.pdf`, plAmount: 5_000_000, plExpiry: "2099-01-01", employsAnyone: false, soleTraderTick: true, ...o,
}) as Parameters<typeof els.installerAddElectrician>[1];
const reject = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e.message));
const biz = async (b: string) => (await db.query<Record<string, unknown>>("select * from businesses where id=$1", [b])).rows[0]!;
const worker = async (b: string) => (await db.query<Record<string, unknown>>("select * from partner_workers where business_id=$1 and removed_at is null order by full_legal_name", [b])).rows[0]!;
const link = async (b: string) => (await db.query<{ active: boolean }>("select active from partner_relationships where installer_business_id=$1 and electrician_business_id=$2", [INST, b])).rows[0] ?? null;
const creds = async (b: string) => (await db.query<{ kind: string; verification: string; verified_by: string | null }>("select kind, verification, verified_by from business_credentials where business_id=$1 order by kind, created_at", [b])).rows;
const events = async (type: string) => (await db.query<{ details: Record<string, unknown> }>("select details from admin_config_events where event_type=$1", [type])).rows;

const { businessId: SAM } = await els.installerAddElectrician(U_BOSS, input());
const { businessId: FINN } = await els.installerAddElectrician(U_BOSS, input({ name: "Finn Fuse", email: "finn@fuse.test", mobile: "0433444555", licenceNumber: "L-9999" }));
const { businessId: RITA } = await els.installerAddElectrician(U_BOSS, input({ name: "Rita Relay", email: "rita@relay.test", licenceNumber: "L-7777", employsAnyone: true, soleTraderTick: false, workcoverFilePath: `${P1}/c-wc.pdf`, workcoverExpiry: "2099-02-02" }));

describe("Needs me: approve item", () => {
  test("every waiting installer-added electrician is one Partner item that opens the business page", async () => {
    const items = await els.pendingInstallerElectricianItems();
    expect(items.map((i) => i.line).sort()).toEqual(["Approve electrician Finn Fuse — added by Insul One", "Approve electrician Rita Relay — added by Insul One", "Approve electrician Sam Sparks — added by Insul One"]);
    const sam = items.find((i) => i.businessId === SAM)!;
    expect(sam.href).toBe(`/admin/partners/business/${SAM}`);
    expect(sam.workerIds).toEqual([(await worker(SAM)).id]);
    expect(sam.since).toBeTruthy();
  });
});

describe("officeApproveInstallerElectrician", () => {
  test("an expired public liability refuses the approval and changes nothing", async () => {
    await db.query("update business_credentials set expires_at='2020-01-01' where business_id=$1 and kind='public_liability_insurance'", [SAM]);
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, SAM))).toBe("Can't approve yet: Public liability has expired");
    expect(await biz(SAM)).toMatchObject({ onboarding_status: "submitted", is_active: false, approved_by: null });
    expect((await worker(SAM)).approval_status).toBe("pending");
    expect(await link(SAM)).toEqual({ active: false });
    expect((await creds(SAM)).every((c) => c.verification === "pending")).toBe(true);
    expect(smsCalls).toHaveLength(0);
    await db.query("update business_credentials set expires_at='2099-01-01' where business_id=$1 and kind='public_liability_insurance'", [SAM]);
  });

  test("the office check mirrors the installer's list: a problem list, never an override", async () => {
    expect(await els.installerElectricianReview(SAM)).toMatchObject({ installerName: "Insul One", installerId: INST, status: "waiting", problems: [], rejectedReason: null });
    expect(await els.installerElectricianReview(INST)).toBeNull(); // not installer-added
  });

  test("approve: business approved + active, person approved, link active, credentials verified, one welcome text", async () => {
    await els.officeApproveInstallerElectrician(OFFICE, SAM);
    const b = await biz(SAM);
    expect(b).toMatchObject({ onboarding_status: "approved", is_active: true, approved_by: OFFICE, installer_added_rejected_reason: null });
    expect(b.approved_at).toBeTruthy();
    const w = await worker(SAM);
    expect(w).toMatchObject({ approval_status: "approved", approved_by: OFFICE });
    expect(mitti).toEqual([w.id]);
    expect(await link(SAM)).toEqual({ active: true });
    const cs = await creds(SAM);
    expect(cs.map((c) => c.kind)).toEqual(["electrical_licence", "public_liability_insurance", "rec_registration"]);
    expect(cs.every((c) => c.verification === "verified" && c.verified_by === OFFICE)).toBe(true);
    expect(smsCalls).toHaveLength(1);
    expect(smsCalls[0]).toMatchObject({ type: "installer_added_electrician_welcome", businessId: SAM, jobId: null, to: "+61400111222", idempotencyKey: core.welcomeSmsKey(SAM) });
    expect(smsCalls[0]!.body).toBe("Hi Sam, Insul One has added you as their electrician with Home Insulation Victoria. They'll send you jobs to book. Cheers, the Home Insulation Victoria team");
    expect(await events("installer_added_electrician_approved")).toHaveLength(1);
    // The installer's list now shows them approved; the office item is gone.
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === SAM)).toMatchObject({ status: "approved" });
    expect((await els.pendingInstallerElectricianItems()).map((i) => i.businessId).sort()).toEqual([FINN, RITA].sort());
  });

  test("approving again is refused and sends nothing more", async () => {
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, SAM))).toBe("Already approved.");
    expect(smsCalls).toHaveLength(1);
  });

  test("approval gives the electrician a portal profile (no login email): exactly one auth user, profile, role, membership; a retry makes none", async () => {
    // Controller ruling 3 Nov 2026: installer-added electricians get a portal PROFILE at approval so the own-job hand-over
    // and the swap can assign them (job_assignments.user_id is NOT NULL). They still never log in and nothing is sent.
    expect(authUsers).toEqual([{ email: "sam@sparks.test", email_confirm: true, full_name: "Sam Sparks" }]);
    const w = await worker(SAM);
    expect(w.profile_id).toBeTruthy();
    expect(w).toMatchObject({ account_status: "linked", linked_by: OFFICE });
    expect(w.linked_at).toBeTruthy();
    expect((await db.query<Record<string, unknown>>("select email, full_name, business_id from profiles where id=$1", [w.profile_id])).rows).toEqual([{ email: "sam@sparks.test", full_name: "Sam Sparks", business_id: SAM }]);
    expect((await db.query<Record<string, unknown>>("select role from user_roles where user_id=$1", [w.profile_id])).rows).toEqual([{ role: "electrician" }]);
    expect((await db.query<Record<string, unknown>>("select member_role, active, added_by from business_members where user_id=$1 and business_id=$2", [w.profile_id, SAM])).rows).toEqual([{ member_role: "business_admin", active: true, added_by: OFFICE }]);
    // A retry (the "vanished link" repair below runs one too) never creates a second user.
    await db.query("update partner_relationships set active=false where electrician_business_id=$1", [SAM]);
    await els.officeApproveInstallerElectrician(OFFICE, SAM);
    expect(authUsers).toHaveLength(1);
    expect((await db.query<{ n: string }>("select count(*)::text as n from profiles where email='sam@sparks.test'")).rows[0]!.n).toBe("1");
    expect((await worker(SAM)).profile_id).toBe(w.profile_id);
  });

  test("a half-done approval with no profile yet stays 'unfinished' and the next click repairs it", async () => {
    await db.query("update partner_workers set profile_id=null, account_status='unlinked', linked_by=null, linked_at=null where business_id=$1", [SAM]);
    expect(await els.installerElectricianReview(SAM)).toMatchObject({ status: "approved", unfinished: true });
    expect((await els.pendingInstallerElectricianItems()).find((i) => i.businessId === SAM)).toMatchObject({ line: "Finish approving electrician Sam Sparks — added by Insul One", unfinished: true });
    await els.officeApproveInstallerElectrician(OFFICE, SAM);
    // The existing profile (same email) is reused: still one auth user.
    expect(authUsers).toHaveLength(1);
    expect((await worker(SAM))).toMatchObject({ profile_id: (await db.query<{ id: string }>("select id from profiles where email='sam@sparks.test'")).rows[0]!.id, account_status: "linked" });
    expect(await els.installerElectricianReview(SAM)).toMatchObject({ unfinished: false });
    expect((await els.pendingInstallerElectricianItems()).find((i) => i.businessId === SAM)).toBeUndefined();
    expect(smsCalls).toHaveLength(1);
  });


  test("retry-safe: a run that fails after the business flips is finished by the next click, with ONE welcome text", async () => {
    failWorkerApprovalOnce = true;
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, FINN))).toMatch(/^Approved, but the electrician's login could not be approved \(database went away\)\. Click Approve again to finish\.$/);
    // Half done: business approved, person still pending, link off, no text — gone from the office list, still "waiting" on the installer's.
    expect(await biz(FINN)).toMatchObject({ onboarding_status: "approved", is_active: true });
    expect((await worker(FINN)).approval_status).toBe("pending");
    expect(await link(FINN)).toEqual({ active: false });
    expect(smsCalls).toHaveLength(1);
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === FINN)).toMatchObject({ status: "waiting" });
    // Still on the office's surfaces: a "Finish approving" item, and the card says Finish approval.
    const items = await els.pendingInstallerElectricianItems();
    expect(items.find((i) => i.businessId === FINN)).toMatchObject({ line: "Finish approving electrician Finn Fuse — added by Insul One", unfinished: true, href: `/admin/partners/business/${FINN}` });
    expect(items.find((i) => i.businessId === RITA)).toMatchObject({ unfinished: false });
    expect(await els.installerElectricianReview(FINN)).toMatchObject({ status: "waiting", unfinished: true });
    // A person the office rejected is never approved by the repair.
    await db.query("insert into partner_workers (business_id, trade_role, full_legal_name, email, approval_status) values ($1,'electrician','Rejected Ray','ray@fuse.test','rejected')", [FINN]);
    // The retry repairs instead of refusing.
    await els.officeApproveInstallerElectrician(OFFICE, FINN);
    expect((await db.query<{ full_legal_name: string; approval_status: string }>("select full_legal_name, approval_status from partner_workers where business_id=$1 order by full_legal_name", [FINN])).rows).toEqual([{ full_legal_name: "Finn Fuse", approval_status: "approved" }, { full_legal_name: "Rejected Ray", approval_status: "rejected" }]);
    expect(await els.installerElectricianReview(FINN)).toMatchObject({ status: "approved", unfinished: false });
    expect((await els.pendingInstallerElectricianItems()).map((i) => i.businessId)).toEqual([RITA]);
    expect(await link(FINN)).toEqual({ active: true });
    expect(smsCalls).toHaveLength(2);
    expect(smsCalls[1]).toMatchObject({ businessId: FINN, idempotencyKey: core.welcomeSmsKey(FINN) });
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === FINN)).toMatchObject({ status: "approved" });
    // Fully done now: a third click is refused and nothing more is sent.
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, FINN))).toBe("Already approved.");
    expect(smsCalls).toHaveLength(2);
  });

  test("retry-safe: an approved electrician whose link is off (the 'vanished' case) gets the link back, no second text", async () => {
    await db.query("update partner_relationships set active=false where electrician_business_id=$1", [SAM]);
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === SAM)).toBeUndefined();
    await els.officeApproveInstallerElectrician(OFFICE, SAM);
    expect(await link(SAM)).toEqual({ active: true });
    expect(smsCalls).toHaveLength(2);
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === SAM)).toMatchObject({ status: "approved" });
  });

  test("the welcome text type is registered: partner audience, held wording, quiet hours", () => {
    expect(SMS_MESSAGE_TYPES.installer_added_electrician_welcome).toMatchObject({ audience: "partner", wordingApproved: false, quietHours: true });
    expect(SMS_FRESHNESS.installer_added_electrician_welcome).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
  });
});

describe("officeRejectInstallerElectrician + installerResubmitElectrician", () => {
  test("a rejection needs a reason; an approved electrician can't be rejected here", async () => {
    expect(await reject(els.officeRejectInstallerElectrician(OFFICE, RITA, "  "))).toBe("Give a reason for not approving them.");
    expect(await reject(els.officeRejectInstallerElectrician(OFFICE, SAM, "Nope"))).toBe("Already approved.");
  });

  test("reject: reason set, link stays inactive, the installer office email is HELD until Jo approves the wording", async () => {
    expect(core.REJECTION_EMAIL_APPROVED).toBe(false);
    await els.officeRejectInstallerElectrician(OFFICE, RITA, "Blurry licence photo");
    expect(await biz(RITA)).toMatchObject({ onboarding_status: "needs_info", is_active: false, installer_added_rejected_reason: "Blurry licence photo" });
    expect(await link(RITA)).toEqual({ active: false });
    expect(emails).toHaveLength(0);
    const held = await events("installer_added_electrician_rejected");
    expect(held).toHaveLength(1);
    expect(held[0]!.details).toMatchObject({ installer_business_id: INST, electrician_business_id: RITA, reason: "Blurry licence photo", email: "held: wording not approved yet" });
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === RITA)).toMatchObject({ status: "not_approved", reason: "Blurry licence photo" });
    expect((await els.pendingInstallerElectricianItems()).map((i) => i.businessId)).toEqual([]);
  });

  test("reject with the wording approved: ONE email to the installer office, recorded against the installer", async () => {
    await els.officeRejectInstallerElectrician(OFFICE, RITA, "Licence number doesn't match the photo", { approved: true });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ recipient: "partner", to: "office@insulone.test", record: { businessId: INST }, pauseJobId: null });
    expect(emails[0]!.message).toBe("Rita Relay wasn't approved: Licence number doesn't match the photo. Fix it in My electricians.");
    expect((await biz(RITA)).installer_added_rejected_reason).toBe("Licence number doesn't match the photo");
  });

  test("Fix and resend (Task 5): what is on file comes back for the form — own, not-approved electricians only", async () => {
    expect(await els.installerMyElectricianDetails(U_BOSS, RITA)).toEqual({
      name: "Rita Relay", email: "rita@relay.test", mobile: "+61400111222", recNumber: "REC5555", licenceNumber: "L-7777", licenceExpiry: "2099-01-01",
      plAmount: 5_000_000, plExpiry: "2099-01-01", employsAnyone: true, workcoverExpiry: "2099-02-02", reason: "Licence number doesn't match the photo",
    });
    expect(await reject(els.installerMyElectricianDetails(U_BOSS2, RITA))).toBe("This electrician isn't on your list.");
    expect(await reject(els.installerMyElectricianDetails(U_BOSS, SAM))).toBe("They're already approved — nothing to resubmit.");
  });

  test("resubmit: only the installer that added them, only while not approved", async () => {
    const fix = input({ name: "Rita Relay", email: "rita@relay.test", licenceNumber: "L-7777", licenceFilePath: `${P1}/new-licence.jpg`, employsAnyone: true, soleTraderTick: false, workcoverFilePath: `${P1}/c-wc.pdf`, workcoverExpiry: "2099-02-02" });
    expect(await reject(els.installerResubmitElectrician(U_BOSS2, RITA, { ...fix, licenceFilePath: `partners/${INST2}/electrician-uploads/x.jpg`, plFilePath: `partners/${INST2}/electrician-uploads/y.pdf`, workcoverFilePath: `partners/${INST2}/electrician-uploads/z.pdf` }))).toBe("This electrician isn't on your list.");
    expect(await reject(els.installerResubmitElectrician(U_BOSS, SAM, input()))).toBe("They're already approved — nothing to resubmit.");
    expect(await reject(els.installerResubmitElectrician(U_BOSS, RITA, { ...fix, name: "" }))).toBe("Add their name");
    expect((await biz(RITA)).onboarding_status).toBe("needs_info");
  });

  test("resubmit: details and documents updated, back to waiting, reason cleared, old paperwork superseded", async () => {
    const fix = input({ name: "Rita Relay-Smith", email: "rita@relay.test", mobile: "0411222333", licenceNumber: "L-7777", licenceExpiry: "2098-06-06", licenceFilePath: `${P1}/new-licence.jpg`, plFilePath: `${P1}/new-pl.pdf`, plAmount: 10_000_000, plExpiry: "2098-07-07", employsAnyone: false, soleTraderTick: true });
    await els.installerResubmitElectrician(U_BOSS, RITA, fix);
    const b = await biz(RITA);
    expect(b).toMatchObject({ onboarding_status: "submitted", installer_added_rejected_reason: null, name: "Rita Relay-Smith", phone: "+61411222333", is_active: false });
    expect(Number(b.public_liability_cover_amount)).toBe(10_000_000);
    expect(b.workcover_exempt_declared_at).toBeTruthy(); // now a sole trader
    const w = await worker(RITA);
    expect(w).toMatchObject({ full_legal_name: "Rita Relay-Smith", licence_number: "L-7777", mobile: "+61411222333", approval_status: "pending" });
    expect(new Date(w.licence_expires_on as string).toISOString().slice(0, 10)).toBe("2098-06-06");
    const cs = await creds(RITA);
    // Old rows are marked rejected (never deleted); fresh pending rows carry the new numbers and files. No new WorkCover: sole trader now.
    expect(cs.filter((c) => c.verification === "rejected").map((c) => c.kind)).toEqual(["electrical_licence", "public_liability_insurance", "rec_registration", "workers_comp_insurance"]);
    expect(cs.filter((c) => c.verification === "pending").map((c) => c.kind)).toEqual(["electrical_licence", "public_liability_insurance", "rec_registration"]);
    const docs = (await db.query<{ kind: string; document_path: string }>("select kind, document_path from business_credentials where business_id=$1 and verification='pending' order by kind", [RITA])).rows;
    expect(docs.find((d) => d.kind === "electrical_licence")!.document_path).toBe(`${P1}/new-licence.jpg`);
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === RITA)).toMatchObject({ status: "waiting", reason: null, licenceExpiry: "2098-06-06", plExpiry: "2098-07-07" });
    expect((await els.pendingInstallerElectricianItems()).map((i) => i.businessId)).toEqual([RITA]);
    expect(await events("installer_added_electrician_resubmitted")).toHaveLength(1);
    // The office checklist sees the new paperwork, not the superseded rows.
    expect(await els.installerElectricianReview(RITA)).toMatchObject({ status: "waiting", problems: [] });
  });

  test("after a resubmit the office can approve; a sender failure is said, kept as unfinished, and the retry sends once", async () => {
    smsThrowOnce = true;
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, RITA))).toBe("Approved, but the welcome text couldn't be sent (Could not check SMS history safely; nothing sent). Click Approve again to retry it.");
    expect(await biz(RITA)).toMatchObject({ onboarding_status: "approved", is_active: true });
    expect(await link(RITA)).toEqual({ active: true });
    expect((await creds(RITA)).filter((c) => c.verification === "pending")).toHaveLength(0);
    expect(smsCalls).toHaveLength(2);
    expect((await els.pendingInstallerElectricianItems()).find((i) => i.businessId === RITA)).toMatchObject({ line: "Finish approving electrician Rita Relay-Smith — added by Insul One", unfinished: true });
    expect(await els.installerElectricianReview(RITA)).toMatchObject({ unfinished: true });
    await els.officeApproveInstallerElectrician(OFFICE, RITA);
    expect(smsCalls).toHaveLength(3);
    expect(smsCalls[2]).toMatchObject({ businessId: RITA, idempotencyKey: core.welcomeSmsKey(RITA) });
    expect((await els.pendingInstallerElectricianItems()).find((i) => i.businessId === RITA)).toBeUndefined();
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, RITA))).toBe("Already approved.");
    expect(smsCalls).toHaveLength(3);
  });
});

describe("after approval", () => {
  test("a licence that expires later blocks the electrician on new jobs (person rule + business document rule)", async () => {
    await db.query("update partner_workers set licence_expires_on='2026-10-01' where business_id=$1", [SAM]);
    const w = await worker(SAM);
    expect(workerOfferBlocker({ trade_role: "electrician", licence_expires_on: new Date(w.licence_expires_on as string).toISOString().slice(0, 10) } as never, "2026-11-03")).toBe("Electrical licence has expired.");
    expect([...BLOCKING_BUSINESS_DOCS]).toContain("electrical_licence");
    expect(expiredBusinessDocsBlocker([{ kind: "electrical_licence", label: "Electrical licence", expires: "2026-10-01", verified: true }], "2026-11-03")).toContain("Electrical licence expired on 2026-10-01");
    expect((await els.installerMyElectricians(U_BOSS)).find((r) => r.id === SAM)).toMatchObject({ status: "expired" });
  });

  test("own-job pick: a lapsed business licence blocks an installer-added electrician; an HIV-onboarded REC is judged on PL + REC registration only", async () => {
    await db.query("update business_credentials set expires_at='2026-10-01' where business_id=$1 and kind='electrical_licence'", [SAM]);
    expect(await els.ownJobDocsBlocker(SAM, "2026-11-03")).toContain("Electrical licence expired on 2026-10-01");
    expect(await els.ownJobDocsBlocker(RITA, "2026-11-03")).toBeNull();
    const REC = id(60);
    await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities) values ($1,'rec','Volt Co','approved',true,'["electrician"]')`, [REC]);
    await db.query("insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'electrical_licence','2020-01-01','verified'), ($1,'public_liability_insurance','2099-01-01','verified')", [REC]);
    expect(await els.ownJobDocsBlocker(REC, "2026-11-03")).toBeNull(); // per-person licence rules cover HIV-onboarded RECs
    await db.query("insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'public_liability_insurance','2026-01-01','rejected'), ($1,'rec_registration','2026-01-01','verified')", [REC]);
    expect(await els.ownJobDocsBlocker(REC, "2026-11-03")).toBe("REC registration expired on 2026-01-01. No new jobs until the renewed document is uploaded.");
    const swap = readFileSync(new URL("../src/lib/electrician-swap.server.ts", import.meta.url), "utf8");
    expect(swap).toContain("ownJobDocsBlocker(electricianBusinessId)");
    // The HIV-lead candidate list is NOT changed by lapsed documents (quoting / invites keep their own rules).
    expect(readFileSync(new URL("../src/lib/rec-onboarded.server.ts", import.meta.url), "utf8")).not.toContain("expiredBusinessDocsBlocker");
  });

  test("installer-added electricians are never Home Insulation Victoria lead candidates", () => {
    const rows = [{ id: "a", added_by_installer_business_id: null }, { id: "b", added_by_installer_business_id: INST }, { id: "c" }];
    expect(core.hivLeadElectricianCandidates(rows).map((r) => r.id)).toEqual(["a", "c"]);
    expect(core.isInstallerAddedElectrician(rows[1])).toBe(true);
    expect(core.isInstallerAddedElectrician(rows[2])).toBe(false);
    const alloc = readFileSync(new URL("../src/lib/allocation.server.ts", import.meta.url), "utf8");
    expect(alloc).toMatch(/hivLeadElectricianCandidates(<\w+>)?\(allBizs/);
  });

  test("the office functions are admin-only", () => {
    const fns = readFileSync(new URL("../src/lib/my-electricians.functions.ts", import.meta.url), "utf8");
    for (const name of ["approveInstallerElectrician", "rejectInstallerElectrician", "getInstallerElectricianReview"]) {
      const at = fns.indexOf(`export const ${name} `);
      expect(at).toBeGreaterThan(-1);
      expect(fns.slice(at, fns.indexOf(".handler", at) + 400)).toContain("requireAdmin(context.supabase)");
    }
  });
});

describe("profile at approval: an email that already belongs to another business", () => {
  test("is refused with the existing message, the approval stays unfinished, and the next click (clash gone) finishes it without a login email", async () => {
    const { businessId: CARL } = await els.installerAddElectrician(U_BOSS, input({ name: "Carl Clash", email: "carl@clash.test", mobile: "0455666777", licenceNumber: "L-4444" }));
    await db.query("insert into profiles (id, email, full_name, business_id) values ($1,'carl@clash.test','Someone Else',$2)", [id(99), INST2]);
    const before = authUsers.length, texts = smsCalls.length;
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, CARL))).toMatch(/^Approved, but .*That email already belongs to another business/);
    expect(await biz(CARL)).toMatchObject({ onboarding_status: "approved", is_active: true });
    expect(await worker(CARL)).toMatchObject({ approval_status: "approved", profile_id: null });
    expect(authUsers).toHaveLength(before);
    expect(smsCalls).toHaveLength(texts); // nothing sent while the approval is unfinished
    expect(await els.installerElectricianReview(CARL)).toMatchObject({ status: "approved", unfinished: true });
    expect((await els.pendingInstallerElectricianItems()).find((i) => i.businessId === CARL)).toMatchObject({ unfinished: true });
    await db.query("delete from profiles where id=$1", [id(99)]);
    await els.officeApproveInstallerElectrician(OFFICE, CARL);
    expect(authUsers).toHaveLength(before + 1);
    expect(authUsers.at(-1)).toEqual({ email: "carl@clash.test", email_confirm: true, full_name: "Carl Clash" });
    expect((await worker(CARL)).profile_id).toBeTruthy();
    expect(await link(CARL)).toEqual({ active: true });
    expect(smsCalls).toHaveLength(texts + 1);
    expect(await els.installerElectricianReview(CARL)).toMatchObject({ unfinished: false });
  });
});
