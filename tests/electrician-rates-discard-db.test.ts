// Practice database (PGlite) for pending 0090 discard-draft. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { selectAgreedRate, type ElectricianRateRow } from "../src/lib/allocation.core";

const S89 = readFileSync(new URL("../docs/pending-migrations/0089_electrician_rates.sql", import.meta.url), "utf8");
const S90 = readFileSync(new URL("../docs/pending-migrations/0090_discard_draft_rate.sql", import.meta.url), "utf8");
const RB90 = readFileSync(new URL("../docs/pending-migrations/0090_discard_draft_rate.rollback.sql", import.meta.url), "utf8");
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
const draft = async (rate: number) => (await db.query<{ id: string }>(`INSERT INTO electrician_rates (business_id,service_type,rate_inc_gst,source_note) VALUES ('${B}','piesa',${rate},'TEST note') RETURNING id`)).rows[0]!.id;
const activate = (id: string) => db.query(`SELECT activate_electrician_rate($1,$2)`, [id, ADMIN]);
const discard = (id: string, actor = ADMIN, reason = "TEST cleanup") => db.query(`SELECT discard_electrician_rate($1,$2,$3)`, [id, actor, reason]);
const status = async (id: string) => (await db.query<{ status: string }>(`SELECT status FROM electrician_rates WHERE id=$1`, [id])).rows[0]!.status;
const rows = async () => (await db.query<ElectricianRateRow>(`SELECT id,business_id,service_type,rate_inc_gst,status,effective_from::text,effective_to::text FROM electrician_rates`)).rows;

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(S89); await db.exec(S90); });

describe("0090 discard draft", () => {
  test("office discards a draft with reason and history records who/why", async () => {
    const id = await draft(999); await discard(id, ADMIN, "TEST cleanup - accidental office draft during access check.");
    expect(await status(id)).toBe("discarded");
    const ev = (await db.query<{ actor_id: string; details: { reason: string } }>(`SELECT actor_id, details FROM electrician_rate_events WHERE rate_id=$1 AND event_type='discarded'`, [id])).rows;
    expect(ev[0]!.actor_id).toBe(ADMIN); expect(ev[0]!.details.reason).toContain("accidental");
  });
  test("reason is required", async () => { await expect(discard(await draft(1), ADMIN, " ")).rejects.toThrow(/reason is required/); });
  test("non-office cannot discard", async () => {
    const id = await draft(1);
    await expect(discard(id, REC)).rejects.toThrow(/Only office/);
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${REC}',false); UPDATE electrician_rates SET status='discarded'; RESET ROLE;`);
    expect(await status(id)).toBe("draft");
  });
  test("active, superseded and expired rates cannot be discarded", async () => {
    const a = await draft(180); await activate(a);
    await expect(discard(a)).rejects.toThrow(/Only a draft/);
    await expect(db.exec(`UPDATE electrician_rates SET status='discarded' WHERE id='${a}'`)).rejects.toThrow();
    const b = await draft(200); await activate(b);
    expect(await status(a)).toBe("superseded"); await expect(discard(a)).rejects.toThrow(/Only a draft/);
    await db.exec(`UPDATE electrician_rates SET status='expired', effective_to=effective_from WHERE id='${b}'`);
    await expect(discard(b)).rejects.toThrow(/Only a draft/);
  });
  test("discarded rate is final, never used for offers and hidden from electricians", async () => {
    const id = await draft(999); await discard(id);
    await expect(activate(id)).rejects.toThrow(/Only a draft/);
    expect(selectAgreedRate(await rows(), B, "piesa", "2026-10-04")).toBeNull();
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${REC}',false);`);
    const seen = (await db.query(`SELECT 1 FROM electrician_rates`)).rows.length; await db.exec("RESET ROLE");
    expect(seen).toBe(0);
  });
  test("office still sees the discarded rate and its history", async () => {
    const id = await draft(999); await discard(id);
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${ADMIN}',false);`);
    const r = (await db.query<{ status: string }>(`SELECT status FROM electrician_rates`)).rows;
    const e = (await db.query(`SELECT 1 FROM electrician_rate_events WHERE event_type='discarded'`)).rows; await db.exec("RESET ROLE");
    expect(r[0]!.status).toBe("discarded"); expect(e.length).toBe(1);
  });
  test("rates can no longer be deleted", async () => { const id = await draft(1); await expect(db.exec(`DELETE FROM electrician_rates WHERE id='${id}'`)).rejects.toThrow(/permanent/); });
  test("rollback applies cleanly when nothing is discarded, and 0090 re-applies", async () => {
    await draft(1); await db.exec(RB90); await db.exec(S90);
  });
});
