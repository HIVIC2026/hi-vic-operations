// PGlite practice run for migration 0132 (fake TEST data only).
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
async function db() {
  const d = new PGlite();
  await d.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
CREATE TABLE public.rec_onboarding_applications (id uuid primary key);
CREATE TABLE public.admins (user_id uuid primary key);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.admins WHERE user_id = auth.uid()) $$;
INSERT INTO public.rec_onboarding_applications VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.admins VALUES ('00000000-0000-4000-8000-0000000000a1');`);
  await d.exec(read("0132_partner_rate_offers.sql"));
  return d;
}
const ins = (round: number, hash: string, status = "sent") => `INSERT INTO public.partner_rate_offers (application_id, round, status, items, gst_registered, token_hash, created_by) VALUES ('00000000-0000-4000-8000-000000000001', ${round}, '${status}', '[{"code":"R5_BATTS","partner_inc_gst":25,"offer_inc_gst":23}]', true, '${hash}', '00000000-0000-4000-8000-0000000000a1')`;
describe("0132 partner rate offers", () => {
  test("one open round, figures immutable, answered once", async () => {
    const d = await db();
    await d.exec(ins(1, "h1"));
    await expect(d.exec(ins(2, "h2"))).rejects.toThrow();
    await expect(d.exec(`UPDATE public.partner_rate_offers SET items='[]'`)).rejects.toThrow(/immutable/);
    await d.exec(`UPDATE public.partner_rate_offers SET status='accepted', responded_at=now(), response='{}'`);
    await expect(d.exec(`UPDATE public.partner_rate_offers SET status='declined'`)).rejects.toThrow(/already_answered/);
    await expect(d.exec(`DELETE FROM public.partner_rate_offers`)).rejects.toThrow(/immutable/);
    await d.exec(ins(2, "h2"));
  });
  test("only office can read; undo removes it", async () => {
    const d = await db();
    await d.exec(ins(1, "h1"));
    await d.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-4000-8000-0000000000c1'`);
    expect((await d.query(`SELECT * FROM public.partner_rate_offers`)).rows.length).toBe(0);
    await d.exec(`SET request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1'`);
    expect((await d.query(`SELECT * FROM public.partner_rate_offers`)).rows.length).toBe(1);
    await d.exec(`RESET ROLE`); await d.exec(read("0132_partner_rate_offers.undo.sql"));
    expect((await d.query(`SELECT to_regclass('public.partner_rate_offers') r`)).rows[0]).toEqual({ r: null });
  });
});
