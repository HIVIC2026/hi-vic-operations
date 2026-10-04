// Practice database (PGlite) for pending 0089 electrician_rates. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { selectAgreedRate, offerRateBlocker, rateToConfirmReasonBlocker, officeSpread, electricianRateText, type ElectricianRateRow } from "../src/lib/allocation.core";

const SQL = readFileSync(new URL("../docs/pending-migrations/0089_electrician_rates.sql", import.meta.url), "utf8");
const ADMIN = "00000000-0000-4000-8000-0000000000aa", REC = "00000000-0000-4000-8000-0000000000bb", B = "10000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.businesses (id uuid primary key, name text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.business_members (business_id uuid, user_id uuid);
GRANT SELECT ON public.user_roles, public.business_members TO authenticated;
CREATE FUNCTION public.has_role(_u uuid, _r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT exists(SELECT 1 FROM public.user_roles WHERE user_id=_u AND role=_r) $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.has_role(auth.uid(),'admin') $$;
CREATE FUNCTION public.is_business_member(_biz uuid, _admin_only boolean) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT exists(SELECT 1 FROM public.business_members WHERE business_id=_biz AND user_id=auth.uid()) $$;
INSERT INTO businesses VALUES ('${B}','TEST Delta Electrical');
INSERT INTO user_roles VALUES ('${ADMIN}','admin'), ('${REC}','electrician');
INSERT INTO business_members VALUES ('${B}','${REC}');`;

let db: PGlite;
const as = async (uid: string, sql: string) => db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uid}',false); ${sql}; RESET ROLE;`);
const draft = async (rate: number, from = "2026-01-01") => (await db.query<{ id: string }>(`INSERT INTO electrician_rates (business_id,service_type,rate_inc_gst,effective_from,source_note) VALUES ('${B}','piesa',${rate},'${from}','REC agreement 2.4') RETURNING id`)).rows[0]!.id;
const rows = async () => (await db.query<ElectricianRateRow>(`SELECT id,business_id,service_type,rate_inc_gst,status,effective_from::text,effective_to::text FROM electrician_rates`)).rows;
const TODAY = "2026-10-04";

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(SQL); });

describe("0089 access", () => {
  test("office can create and activate a PIESA rate", async () => {
    await as(ADMIN, `INSERT INTO electrician_rates (business_id,service_type,rate_inc_gst,source_note) VALUES ('${B}','piesa',180,'office-approved')`);
    const id = (await rows())[0]!.id;
    await db.query(`SELECT activate_electrician_rate($1,$2)`, [id, ADMIN]);
    expect((await rows())[0]!.status).toBe("active");
  });
  test("non-office cannot create, edit or activate; electrician cannot edit own rate", async () => {
    await expect(as(REC, `INSERT INTO electrician_rates (business_id,service_type,rate_inc_gst,source_note) VALUES ('${B}','piesa',999,'self')`)).rejects.toThrow();
    const id = await draft(180); await db.query(`SELECT activate_electrician_rate($1,$2)`, [id, ADMIN]);
    await as(REC, `UPDATE electrician_rates SET rate_inc_gst=999`);
    expect(Number((await rows())[0]!.rate_inc_gst)).toBe(180);
    await expect(db.query(`SELECT activate_electrician_rate($1,$2)`, [await draft(500), REC])).rejects.toThrow(/Only office/);
  });
  test("electrician reads own ACTIVE rate only", async () => {
    await draft(150); const id = await draft(180); await db.query(`SELECT activate_electrician_rate($1,$2)`, [id, ADMIN]);
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${REC}',false);`);
    const seen = (await db.query<{ status: string }>(`SELECT status FROM electrician_rates`)).rows; await db.exec("RESET ROLE");
    expect(seen.map((r) => r.status)).toEqual(["active"]);
  });
  test("active rates are frozen; activating a new one supersedes the old", async () => {
    const a = await draft(180); await db.query(`SELECT activate_electrician_rate($1,$2)`, [a, ADMIN]);
    await expect(db.exec(`UPDATE electrician_rates SET rate_inc_gst=200 WHERE id='${a}'`)).rejects.toThrow(/cannot be edited/);
    const b = await draft(200, "2026-06-01"); await db.query(`SELECT activate_electrician_rate($1,$2)`, [b, ADMIN]);
    const r = await rows();
    expect(r.find((x) => x.id === a)!.status).toBe("superseded");
    expect(r.find((x) => x.id === b)!.status).toBe("active");
    await expect(db.exec(`UPDATE electrician_rates SET status='active' WHERE id='${a}'`)).rejects.toThrow();
  });
});

describe("offer rate selection", () => {
  const row = (o: Partial<ElectricianRateRow>): ElectricianRateRow => ({ id: "r", business_id: B, service_type: "piesa", rate_inc_gst: 180, status: "active", effective_from: "2026-01-01", effective_to: null, ...o });
  test("offer uses the active rate", () => { expect(selectAgreedRate([row({})], B, "piesa", TODAY)?.rate_inc_gst).toBe(180); });
  test("draft, superseded, expired and out-of-window rates are never used", () => {
    for (const status of ["draft", "superseded", "expired"]) expect(selectAgreedRate([row({ status })], B, "piesa", TODAY)).toBeNull();
    expect(selectAgreedRate([row({ effective_to: "2026-09-30" })], B, "piesa", TODAY)).toBeNull();
    expect(selectAgreedRate([row({ effective_from: "2026-12-01" })], B, "piesa", TODAY)).toBeNull();
    expect(selectAgreedRate([row({ service_type: "rectification_visit" })], B, "piesa", TODAY)).toBeNull();
  });
  test("missing rate skips the electrician unless office overrides with a reason", () => {
    expect(offerRateBlocker(null, false)).toMatch(/No agreed electrician rate/);
    expect(rateToConfirmReasonBlocker(true, "")).toMatch(/reason is required/);
    expect(rateToConfirmReasonBlocker(true, "REC agreed by phone, rate to follow")).toBeNull();
  });
  test("offer snapshot is unaffected by later rate changes", async () => {
    const a = await draft(180); await db.query(`SELECT activate_electrician_rate($1,$2)`, [a, ADMIN]);
    const snap = { electrician_rate_inc_gst: Number(selectAgreedRate(await rows(), B, "piesa", TODAY)!.rate_inc_gst), electrician_rate_id: a };
    const frozen = JSON.parse(JSON.stringify(snap));
    const b = await draft(220); await db.query(`SELECT activate_electrician_rate($1,$2)`, [b, ADMIN]);
    expect(Number(selectAgreedRate(await rows(), B, "piesa", TODAY)!.rate_inc_gst)).toBe(220);
    expect(frozen).toEqual(snap);
    expect(electricianRateText(frozen)).toBe("Your agreed rate: $180.00 inc GST");
  });
  test("electrician sees agreed rate only; office sees customer price, rate and spread", () => {
    const t = electricianRateText({ electrician_rate_inc_gst: 180 });
    expect(t).not.toContain("349"); expect(t.toLowerCase()).not.toContain("spread");
    expect(officeSpread(349, 180).text).toBe("Customer $349.00 · Electrician $180.00 · Spread $169.00 (inc GST)");
  });
});
