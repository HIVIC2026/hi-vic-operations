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
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role text, full_legal_name text, email text, mobile text, rec_number text, licence_number text, licence_expires_on date, approval_status text, added_by uuid, removed_at timestamptz, approved_by uuid, approved_at timestamptz, rejection_reason text);
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, number text, expires_at date, document_path text, verification text not null default 'pending' CHECK (verification IN ('pending','verified','rejected')), critical boolean, created_by uuid, verified_by uuid, verified_at timestamptz, created_at timestamptz default now());
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid not null, electrician_business_id uuid not null, active boolean not null default true, preferred boolean default false, is_primary boolean default false, source text, notes text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
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
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...postgrestShim(db), storage } }));
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => undefined }));
const smsCalls: { type: string; businessId: string | null; jobId: string | null; to: string | null; body: string; idempotencyKey: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  smsHoldReason: async () => null,
  sendRealSms: async (i: (typeof smsCalls)[number]) => { smsCalls.push(i); return { status: "blocked", detail: "wording not approved", sid: null }; },
}));
const emails: { to: string; subject: string; message: string; record: unknown; pauseJobId: unknown; recipient: string }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: (typeof emails)[number]) => { emails.push(p); return { channel: "email", to: p.to, status: "sent", detail: "" }; } }));
const mitti: string[] = [];
mock.module("../src/lib/mitti-invite.server", () => ({ onPartnerPersonApproved: async (w: string) => { mitti.push(w); }, onPartnerPersonRemoved: async () => undefined }));

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
const worker = async (b: string) => (await db.query<Record<string, unknown>>("select * from partner_workers where business_id=$1 and removed_at is null", [b])).rows[0]!;
const link = async (b: string) => (await db.query<{ active: boolean }>("select active from partner_relationships where installer_business_id=$1 and electrician_business_id=$2", [INST, b])).rows[0] ?? null;
const creds = async (b: string) => (await db.query<{ kind: string; verification: string; verified_by: string | null }>("select kind, verification, verified_by from business_credentials where business_id=$1 order by kind, created_at", [b])).rows;
const events = async (type: string) => (await db.query<{ details: Record<string, unknown> }>("select details from admin_config_events where event_type=$1", [type])).rows;

const { businessId: SAM } = await els.installerAddElectrician(U_BOSS, input());
const { businessId: RITA } = await els.installerAddElectrician(U_BOSS, input({ name: "Rita Relay", email: "rita@relay.test", licenceNumber: "L-7777", employsAnyone: true, soleTraderTick: false, workcoverFilePath: `${P1}/c-wc.pdf`, workcoverExpiry: "2099-02-02" }));

describe("Needs me: approve item", () => {
  test("every waiting installer-added electrician is one Partner item that opens the business page", async () => {
    const items = await els.pendingInstallerElectricianItems();
    expect(items.map((i) => i.line).sort()).toEqual(["Approve electrician Rita Relay — added by Insul One", "Approve electrician Sam Sparks — added by Insul One"]);
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
    expect((await els.pendingInstallerElectricianItems()).map((i) => i.businessId)).toEqual([RITA]);
  });

  test("approving again is refused and sends nothing more", async () => {
    expect(await reject(els.officeApproveInstallerElectrician(OFFICE, SAM))).toBe("Already approved.");
    expect(smsCalls).toHaveLength(1);
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

  test("after a resubmit the office can approve", async () => {
    await els.officeApproveInstallerElectrician(OFFICE, RITA);
    expect(await biz(RITA)).toMatchObject({ onboarding_status: "approved", is_active: true });
    expect(await link(RITA)).toEqual({ active: true });
    expect((await creds(RITA)).filter((c) => c.verification === "pending")).toHaveLength(0);
    expect(smsCalls).toHaveLength(2);
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
