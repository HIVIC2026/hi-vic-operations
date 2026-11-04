// Part 2b Task 2: an installer boss adds an electrician (PGlite). Real server code; only storage and the sign-in lookup are stubbed.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key default gen_random_uuid(), business_type text, capabilities jsonb default '[]', name text, email text, phone text, rec_number text, onboarding_status text, is_active boolean, public_liability_cover_amount numeric,
  added_by_installer_business_id uuid references businesses(id), workcover_exempt_declared_at timestamptz, installer_added_rejected_reason text, onboarding_notes text);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role text, full_legal_name text, email text, mobile text, rec_number text, licence_number text, licence_expires_on date, approval_status text, added_by uuid, removed_at timestamptz);
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, number text, expires_at date, document_path text, verification text, critical boolean, created_by uuid);
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid not null, electrician_business_id uuid not null, active boolean not null default true, preferred boolean default false, is_primary boolean default false, source text, notes text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), INST2 = id(2), APPROVED = id(3), U_BOSS = id(11), U_BOSS2 = id(12), U_STAFF = id(13), U_ELEC = id(14);
await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities) values ($1,'eec_installer','Insul One','approved',true,'[]'), ($2,'eec_installer','Insul Two','approved',true,'[]'), ($3,'rec','Volt Co','approved',true,'["electrician"]')`, [INST, INST2, APPROVED]);
await db.query(`insert into partner_workers (business_id, trade_role, full_legal_name, email, licence_number, licence_expires_on, approval_status) values ($1,'electrician','Vic Volt','Vic@Volt.test','REC-L 99','2099-01-01','approved')`, [APPROVED]);
await db.query(`insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'public_liability_insurance','2099-01-01','verified'), ($1,'workers_comp_insurance','2099-01-01','verified')`, [APPROVED]);
// Extra electricians for the status branches (licence numbers EXP1, INACT1, REJ1, REJ2, TEST1).
const mk = async (n: number, lic: string, o: { status: string; active: boolean; licExp: string; rejected?: string; addedBy?: string; notes?: string }) => {
  await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities, installer_added_rejected_reason, added_by_installer_business_id, workcover_exempt_declared_at, onboarding_notes) values ($1,'rec',$2,$3,$4,'["electrician"]',$5,$6,now(),$7)`, [id(n), "E" + n, o.status, o.active, o.rejected ?? null, o.addedBy ?? null, o.notes ?? null]);
  await db.query(`insert into partner_workers (business_id, trade_role, full_legal_name, email, licence_number, licence_expires_on, approval_status) values ($1,'electrician',$2,$3,$4,$5,$6)`, [id(n), "E" + n, `e${n}@x.test`, lic, o.licExp, o.status === "approved" ? "approved" : "pending"]);
  await db.query(`insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'public_liability_insurance','2099-01-01','verified')`, [id(n)]);
};
await mk(20, "EXP1", { status: "approved", active: true, licExp: "2020-01-01" });
await mk(21, "INACT1", { status: "approved", active: false, licExp: "2099-01-01" });
await mk(22, "REJ1", { status: "submitted", active: false, licExp: "2099-01-01", rejected: "Blurry licence photo", addedBy: INST });
await mk(23, "REJ2", { status: "submitted", active: false, licExp: "2099-01-01", rejected: "Blurry licence photo", addedBy: INST2 });
await mk(24, "TEST1", { status: "approved", active: true, licExp: "2099-01-01", notes: "[TEST PARTNER]" });

const INST_T = id(4), U_BOSS_T = id(15);
await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, onboarding_notes) values ($1,'eec_installer','Test Insul','approved',true,'[TEST PARTNER]')`, [INST_T]);
const people: Record<string, { biz: string; kind: string; boss: boolean }> = { [U_BOSS_T]: { biz: INST_T, kind: "installer", boss: true }, [U_BOSS]: { biz: INST, kind: "installer", boss: true }, [U_BOSS2]: { biz: INST2, kind: "installer", boss: true }, [U_STAFF]: { biz: INST, kind: "installer", boss: false }, [U_ELEC]: { biz: APPROVED, kind: "electrician", boss: true } };
const WorkflowErr = class extends Error {};
const realWf = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWf, WorkflowError: WorkflowErr }));
mock.module("../src/lib/trade-view.server", () => ({
  bossOrThrow: async (u: string) => { const p = people[u]; if (!p) throw new WorkflowErr("Your sign-in isn't linked to an approved business yet."); if (!p.boss) throw new WorkflowErr("Only the business owner can see this."); return { biz: { id: p.biz, onboarding_notes: p.biz === INST_T ? "[TEST PARTNER]" : null }, kind: p.kind, boss: true }; },
}));
const uploads: string[] = [];
const storage = { from: () => ({ createSignedUploadUrl: async (p: string) => { uploads.push(p); return { data: { signedUrl: `https://s.test/${p}`, token: "t" }, error: null }; } }) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...postgrestShim(db), storage } }));
let badFile = false;
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => { if (badFile) throw new Error("bad file"); } }));
const els = await import("../src/lib/my-electricians.server");

const P1 = `partners/${INST}/electrician-uploads`;
const input = (o: Record<string, unknown> = {}) => ({
  name: "Sam Sparks", email: "sam@sparks.test", mobile: "0400111222", recNumber: "REC5555", licenceNumber: "L-5555", licenceExpiry: "2099-01-01",
  licenceFilePath: `${P1}/a-licence.jpg`, plFilePath: `${P1}/b-pl.pdf`, plAmount: 5_000_000, plExpiry: "2099-01-01", employsAnyone: false, soleTraderTick: true, ...o,
}) as Parameters<typeof els.installerAddElectrician>[1];
const count = async (t: string) => Number((await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0]!.n);
const reject = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e.message));

describe("installerAddElectrician", () => {
  test("a new electrician creates a pending business, person, credentials and an inactive link", async () => {
    const r = await els.installerAddElectrician(U_BOSS, input({ employsAnyone: true, soleTraderTick: false, workcoverFilePath: `${P1}/c-wc.pdf`, workcoverExpiry: "2099-02-02" }));
    expect(r.result).toBe("added");
    const b = (await db.query<Record<string, unknown>>("select * from businesses where id=$1", [r.businessId])).rows[0]!;
    expect(b).toMatchObject({ business_type: "rec", onboarding_status: "submitted", is_active: false, added_by_installer_business_id: INST, workcover_exempt_declared_at: null, rec_number: "REC5555" });
    expect(b.capabilities).toEqual(["electrician"]);
    const w = (await db.query<Record<string, unknown>>("select * from partner_workers where business_id=$1", [r.businessId])).rows;
    expect(w).toHaveLength(1); expect(w[0]).toMatchObject({ trade_role: "electrician", approval_status: "pending", licence_number: "L-5555" });
    const kinds = (await db.query<{ kind: string; verification: string }>("select kind, verification from business_credentials where business_id=$1 order by kind", [r.businessId])).rows;
    expect(kinds.map((k) => k.kind)).toEqual(["electrical_licence", "public_liability_insurance", "rec_registration", "workers_comp_insurance"]);
    expect(kinds.every((k) => k.verification === "pending")).toBe(true);
    const rel = (await db.query<Record<string, unknown>>("select * from partner_relationships where electrician_business_id=$1", [r.businessId])).rows[0]!;
    expect(rel).toMatchObject({ installer_business_id: INST, active: false, source: "installer_added" });
    const ev = (await db.query<{ event_type: string }>("select event_type from admin_config_events")).rows;
    expect(ev.filter((e) => e.event_type === "installer_added_electrician")).toHaveLength(1);
  });

  test("sole trader gets no WorkCover credential and is marked exempt", async () => {
    const r = await els.installerAddElectrician(U_BOSS, input({ name: "Solo", email: "solo@x.test", licenceNumber: "L-7777" }));
    const kinds = (await db.query<{ kind: string }>("select kind from business_credentials where business_id=$1", [r.businessId])).rows.map((k) => k.kind);
    expect(kinds).not.toContain("workers_comp_insurance");
    expect((await db.query<{ t: unknown }>("select workcover_exempt_declared_at t from businesses where id=$1", [r.businessId])).rows[0]!.t).not.toBeNull();
  });

  test("the same installer adding the same electrician again is refused", async () => {
    expect(await reject(els.installerAddElectrician(U_BOSS, input()))).toBe("Already on your list");
  });

  test("a second installer adding the same pending electrician is refused", async () => {
    const before = await count("businesses");
    const p2 = (o = {}) => input({ licenceFilePath: `partners/${INST2}/electrician-uploads/a.jpg`, plFilePath: `partners/${INST2}/electrician-uploads/b.pdf`, ...o });
    expect(await reject(els.installerAddElectrician(U_BOSS2, p2()))).toBe("This electrician is already waiting for approval");
    expect(await reject(els.installerAddElectrician(U_BOSS2, p2({ licenceNumber: "zzz", email: "SAM@sparks.TEST" })))).toBe("This electrician is already waiting for approval");
    expect(await count("businesses")).toBe(before);
  });

  test("a match on an approved electrician links them: active link, no new business", async () => {
    const before = await count("businesses");
    const r = await els.installerAddElectrician(U_BOSS, input({ name: "Vic", email: "other@x.test", licenceNumber: "recl99" }));
    expect(r).toEqual({ result: "linked", businessId: APPROVED });
    expect(await count("businesses")).toBe(before);
    expect((await db.query<{ active: boolean }>("select active from partner_relationships where installer_business_id=$1 and electrician_business_id=$2", [INST, APPROVED])).rows).toEqual([{ active: true }]);
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "vic@volt.test" })))).toBe("Already on your list");
  });

  test("final review I2: an approved sole-trader REC with no WorkCover row and no licence expiry on file links (not 'Expired')", async () => {
    const SOLE = id(5);
    await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities) values ($1,'rec','Solo Sparks','approved',true,'["electrician"]')`, [SOLE]);
    await db.query(`insert into partner_workers (business_id, trade_role, full_legal_name, email, licence_number, licence_expires_on, approval_status) values ($1,'electrician','Sol Solo','sol@solo.test','SOLO-1',null,'approved')`, [SOLE]);
    await db.query(`insert into business_credentials (business_id, kind, expires_at, verification) values ($1,'public_liability_insurance','2099-01-01','verified')`, [SOLE]);
    const r = await els.installerAddElectrician(U_BOSS, input({ name: "Sol", email: "sol@solo.test", licenceNumber: "solo1" }));
    expect(r).toEqual({ result: "linked", businessId: SOLE });
    expect((await db.query<{ active: boolean }>("select active from partner_relationships where installer_business_id=$1 and electrician_business_id=$2", [INST, SOLE])).rows).toEqual([{ active: true }]);
    const row = (await els.installerMyElectricians(U_BOSS)).find((e) => e.id === SOLE)!;
    expect(row.status).toBe("approved");
    expect(row.licenceExpiry).toBeNull();
  });

  test("an approved electrician matched by email links the second installer too", async () => {
    const r = await els.installerAddElectrician(U_BOSS2, input({ email: "VIC@volt.test", licenceNumber: "nope", licenceFilePath: `partners/${INST2}/electrician-uploads/a.jpg`, plFilePath: `partners/${INST2}/electrician-uploads/b.pdf` }));
    expect(r.result).toBe("linked");
  });

  test("a file outside the caller's own folder is refused and nothing is written", async () => {
    const before = [await count("businesses"), await count("business_credentials")];
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "n1@x.test", licenceNumber: "N1", plFilePath: `partners/${INST2}/electrician-uploads/b.pdf` })))).toMatch(/doesn't belong/);
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "n1@x.test", licenceNumber: "N1", licenceFilePath: `partners/${INST}/credentials/x.jpg` })))).toMatch(/doesn't belong/);
    expect([await count("businesses"), await count("business_credentials")]).toEqual(before);
  });

  test("a missing required answer is refused in plain words", async () => {
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ name: "", email: "n2@x.test" })))).toBe("Add their name");
  });

  test("staff, electricians and strangers are refused", async () => {
    const before = await count("businesses");
    expect(await reject(els.installerAddElectrician(U_STAFF, input({ email: "n3@x.test", licenceNumber: "N3" })))).toBe("Only the business owner can see this.");
    expect(await reject(els.installerAddElectrician(U_ELEC, input({ email: "n3@x.test", licenceNumber: "N3" })))).toBe("Only an installer's business owner can add electricians.");
    expect(await reject(els.installerAddElectrician(id(99), input({ email: "n3@x.test", licenceNumber: "N3" })))).toMatch(/isn't linked/);
    expect(await count("businesses")).toBe(before);
  });

  test("an abandoned upload (files uploaded, no add) creates no rows", async () => {
    const before = [await count("businesses"), await count("partner_workers"), await count("business_credentials"), await count("partner_relationships")];
    const u = await els.myElectricianUploadUrl(U_BOSS, "licence", "My Licence.jpg");
    expect(u.path.startsWith(`${P1}/`)).toBe(true);
    expect(u.path).toMatch(/-licence-My_Licence\.jpg$/);
    expect(u.signedUrl).toContain(u.path);
    expect([await count("businesses"), await count("partner_workers"), await count("business_credentials"), await count("partner_relationships")]).toEqual(before);
    expect(await reject(els.myElectricianUploadUrl(U_STAFF, "pl", "x.pdf"))).toBe("Only the business owner can see this.");
    expect(await reject(els.myElectricianUploadUrl(U_BOSS, "pl", "virus.exe"))).toMatch(/isn't accepted/);
  });

  test("a failure part-way cleans everything up", async () => {
    await db.exec("alter table partner_relationships add constraint boom check (source <> 'installer_added' or false) not valid");
    const before = [await count("businesses"), await count("partner_workers"), await count("business_credentials"), await count("partner_relationships"), await count("admin_config_events")];
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "n4@x.test", licenceNumber: "N4" })))).toMatch(/Nothing was saved/);
    expect([await count("businesses"), await count("partner_workers"), await count("business_credentials"), await count("partner_relationships"), await count("admin_config_events")]).toEqual(before);
    await db.exec("alter table partner_relationships drop constraint boom");
  });

  test("a file that fails the safety check creates nothing", async () => {
    badFile = true;
    const before = await count("businesses");
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "n5@x.test", licenceNumber: "N5" })))).toBe("bad file");
    expect(await count("businesses")).toBe(before);
    badFile = false;
  });

  test("linking an approved electrician whose licence has lapsed is refused", async () => {
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "a@x.test", licenceNumber: "exp1" })))).toBe("Their paperwork has expired. Ask them to update it with Home Insulation Victoria.");
    expect((await db.query("select 1 from partner_relationships where electrician_business_id=$1", [id(20)])).rows).toHaveLength(0);
  });
  test("an approved but switched-off electrician gets the same message", async () => {
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "a@x.test", licenceNumber: "INACT1" })))).toMatch(/^Their paperwork has expired/);
  });
  test("rejected, added by this installer: says why and where to fix it", async () => {
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "a@x.test", licenceNumber: "REJ1" })))).toBe("Not approved: Blurry licence photo. Add them on the Team page.");
  });
  test("rejected, added by another installer: neutral message, no reason shown", async () => {
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "a@x.test", licenceNumber: "REJ2" })))).toBe("This electrician can't be added right now — contact Home Insulation Victoria");
  });
  test("a TEST electrician is never matched by a real installer (a new one is added instead)", async () => {
    const r = await els.installerAddElectrician(U_BOSS, input({ email: "t@x.test", licenceNumber: "TEST1" }));
    expect(r.result).toBe("added"); expect(r.businessId).not.toBe(id(24));
  });
  test("bad dates, email and mobile are refused in plain words", async () => {
    const before = await count("businesses");
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ licenceExpiry: "2099-99-99" })))).toBe("Enter a real date");
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ plExpiry: "2099-02-30" })))).toBe("Enter a real date");
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "not-an-email" })))).toBe("Enter a valid email");
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ mobile: "12345" })))).toBe("Enter a valid Australian mobile");
    expect(await count("businesses")).toBe(before);
  });
  test("two installers adding the same new electrician at once: one business, one link, the loser is told why and the winner's rows survive", async () => {
    const p2 = { licenceFilePath: `partners/${INST2}/electrician-uploads/a.jpg`, plFilePath: `partners/${INST2}/electrician-uploads/b.pdf` };
    const same = { email: "race@x.test", licenceNumber: "RACE-1" };
    const [a, b] = await Promise.allSettled([els.installerAddElectrician(U_BOSS, input(same)), els.installerAddElectrician(U_BOSS2, input({ ...same, ...p2 }))]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const loser = (a.status === "rejected" ? a : b) as PromiseRejectedResult;
    expect(loser.reason.message).toBe("This electrician is already waiting for approval");
    expect((await db.query("select 1 from businesses where rec_number='REC5555' and email='race@x.test'")).rows).toHaveLength(1);
    const bid = ((a.status === "fulfilled" ? a : b) as PromiseFulfilledResult<{ businessId: string }>).value.businessId;
    expect((await db.query("select 1 from partner_relationships where electrician_business_id=$1", [bid])).rows).toHaveLength(1);
    expect((await db.query("select 1 from partner_workers where business_id=$1", [bid])).rows).toHaveLength(1);
    expect((await db.query("select 1 from business_credentials where business_id=$1", [bid])).rows).toHaveLength(3);
  });
  test("the same installer racing itself is told 'Already on your list'", async () => {
    const same = { email: "race2@x.test", licenceNumber: "RACE-2" };
    const rs = await Promise.allSettled([els.installerAddElectrician(U_BOSS, input(same)), els.installerAddElectrician(U_BOSS, input(same))]);
    expect(rs.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(((rs.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as Error).message).toBe("Already on your list");
    expect((await db.query("select 1 from businesses where email='race2@x.test'")).rows).toHaveLength(1);
  });

  test("a TEST installer and a real installer can add the same licence without blocking each other", async () => {
    const same = { email: "iso@x.test", licenceNumber: "ISO-1" };
    const real = await els.installerAddElectrician(U_BOSS, input(same));
    const test = await els.installerAddElectrician(U_BOSS_T, input({ ...same, licenceFilePath: `partners/${INST_T}/electrician-uploads/a.jpg`, plFilePath: `partners/${INST_T}/electrician-uploads/b.pdf` }));
    expect(test.businessId).not.toBe(real.businessId);
    expect((await db.query<{ onboarding_notes: string | null }>("select onboarding_notes from businesses where id=$1", [test.businessId])).rows[0]!.onboarding_notes).toBe("[TEST PARTNER]");
    expect((await db.query<{ onboarding_notes: string | null }>("select onboarding_notes from businesses where id=$1", [real.businessId])).rows[0]!.onboarding_notes).toBeNull();
    expect((await db.query("select 1 from partner_relationships where installer_business_id=$1 and electrician_business_id=$2", [INST_T, real.businessId])).rows).toHaveLength(0);
  });
  test("a clash with a row that has no live matching person gets the neutral message", async () => {
    const first = await els.installerAddElectrician(U_BOSS, input({ email: "ghost@x.test", licenceNumber: "GHOST-1" }));
    await db.query("update partner_workers set removed_at=now() where business_id=$1", [first.businessId]);
    const before = await count("businesses");
    expect(await reject(els.installerAddElectrician(U_BOSS2, input({ email: "ghost@x.test", licenceNumber: "GHOST-1", licenceFilePath: `partners/${INST2}/electrician-uploads/a.jpg`, plFilePath: `partners/${INST2}/electrician-uploads/b.pdf` })))).toBe("This electrician can't be added right now — contact Home Insulation Victoria");
    expect(await count("businesses")).toBe(before);
    expect((await db.query("select 1 from businesses where id=$1", [first.businessId])).rows).toHaveLength(1); // the existing row is untouched
  });
  test("the phone is stored in +61 form", async () => {
    const r = await els.installerAddElectrician(U_BOSS, input({ email: "ph@x.test", licenceNumber: "PH-1", mobile: "0400 111 222" }));
    expect((await db.query<{ phone: string }>("select phone from businesses where id=$1", [r.businessId])).rows[0]!.phone).toBe("+61400111222");
    expect((await db.query<{ mobile: string }>("select mobile from partner_workers where business_id=$1", [r.businessId])).rows[0]!.mobile).toBe("+61400111222");
  });

  test("until the pending SQL is applied it refuses and writes nothing", async () => {
    await db.exec("alter table businesses drop column workcover_exempt_declared_at");
    const before = [await count("businesses"), await count("partner_workers"), await count("partner_relationships")];
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "n6@x.test", licenceNumber: "N6" })))).toBe("This feature isn't switched on yet.");
    expect([await count("businesses"), await count("partner_workers"), await count("partner_relationships")]).toEqual(before);
  });
});
