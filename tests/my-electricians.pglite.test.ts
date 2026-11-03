// Part 2b Task 2: an installer boss adds an electrician (PGlite). Real server code; only storage and the sign-in lookup are stubbed.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key default gen_random_uuid(), business_type text, capabilities jsonb default '[]', name text, email text, phone text, rec_number text, onboarding_status text, is_active boolean, public_liability_cover_amount numeric,
  added_by_installer_business_id uuid references businesses(id), workcover_exempt_declared_at timestamptz, installer_added_rejected_reason text);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role text, full_legal_name text, email text, mobile text, rec_number text, licence_number text, licence_expires_on date, approval_status text, added_by uuid, removed_at timestamptz);
CREATE TABLE business_credentials (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, label text, number text, expires_at date, document_path text, verification text, critical boolean, created_by uuid);
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid not null, electrician_business_id uuid not null, active boolean not null default true, preferred boolean default false, is_primary boolean default false, source text, notes text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), INST2 = id(2), APPROVED = id(3), U_BOSS = id(11), U_BOSS2 = id(12), U_STAFF = id(13), U_ELEC = id(14);
await db.query(`insert into businesses (id, business_type, name, onboarding_status, is_active, capabilities) values ($1,'eec_installer','Insul One','approved',true,'[]'), ($2,'eec_installer','Insul Two','approved',true,'[]'), ($3,'rec','Volt Co','approved',true,'["electrician"]')`, [INST, INST2, APPROVED]);
await db.query(`insert into partner_workers (business_id, trade_role, full_legal_name, email, licence_number, approval_status) values ($1,'electrician','Vic Volt','Vic@Volt.test','REC-L 99','approved')`, [APPROVED]);

const people: Record<string, { biz: string; kind: string; boss: boolean }> = { [U_BOSS]: { biz: INST, kind: "installer", boss: true }, [U_BOSS2]: { biz: INST2, kind: "installer", boss: true }, [U_STAFF]: { biz: INST, kind: "installer", boss: false }, [U_ELEC]: { biz: APPROVED, kind: "electrician", boss: true } };
const WorkflowErr = class extends Error {};
const realWf = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWf, WorkflowError: WorkflowErr }));
mock.module("../src/lib/trade-view.server", () => ({
  bossOrThrow: async (u: string) => { const p = people[u]; if (!p) throw new WorkflowErr("Your sign-in isn't linked to an approved business yet."); if (!p.boss) throw new WorkflowErr("Only the business owner can see this."); return { biz: { id: p.biz }, kind: p.kind, boss: true }; },
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

  test("until the pending SQL is applied it refuses and writes nothing", async () => {
    await db.exec("alter table businesses drop column workcover_exempt_declared_at");
    const before = [await count("businesses"), await count("partner_workers"), await count("partner_relationships")];
    expect(await reject(els.installerAddElectrician(U_BOSS, input({ email: "n6@x.test", licenceNumber: "N6" })))).toBe("This feature isn't switched on yet.");
    expect([await count("businesses"), await count("partner_workers"), await count("partner_relationships")]).toEqual(before);
  });
});
