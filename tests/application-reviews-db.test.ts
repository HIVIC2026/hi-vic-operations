// PGlite practice run for migration 0142 (fake TEST data only).
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", U = "00000000-0000-4000-8000-0000000000a1";
async function db() {
  const d = new PGlite();
  await d.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
CREATE TABLE public.rec_onboarding_applications (id uuid primary key);
CREATE TABLE public.admins (user_id uuid primary key);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.admins WHERE user_id = auth.uid()) $$;
INSERT INTO public.rec_onboarding_applications VALUES ('${A}'), ('${B}');
INSERT INTO public.admins VALUES ('${U}');`);
  await d.exec(read("0142_application_reviews.sql"));
  return d;
}
describe("0142 application reviews", () => {
  test("one permanent decision per signed application; only the email outcome can be recorded", async () => {
    const d = await db();
    await expect(d.exec(`INSERT INTO public.application_reviews (application_id, decision, message, created_by) VALUES ('${A}', 'changes_requested', '', '${U}')`)).rejects.toThrow();
    await expect(d.exec(`INSERT INTO public.application_reviews (application_id, decision, reopened_application_id, created_by) VALUES ('${A}', 'declined', '${B}', '${U}')`)).rejects.toThrow();
    await d.exec(`INSERT INTO public.application_reviews (application_id, decision, message, reopened_application_id, created_by) VALUES ('${A}', 'changes_requested', 'Please check your batts removal rate.', '${B}', '${U}')`);
    await expect(d.exec(`INSERT INTO public.application_reviews (application_id, decision, created_by) VALUES ('${A}', 'declined', '${U}')`)).rejects.toThrow();
    await d.exec(`UPDATE public.application_reviews SET email_status = 'sent', email_detail = 'test inbox'`);
    await expect(d.exec(`UPDATE public.application_reviews SET message = 'changed'`)).rejects.toThrow(/immutable/);
    await expect(d.exec(`DELETE FROM public.application_reviews`)).rejects.toThrow(/immutable/);
  });
  test("only the office can read; undo removes it", async () => {
    const d = await db();
    await d.exec(`INSERT INTO public.application_reviews (application_id, decision, created_by) VALUES ('${A}', 'declined', '${U}')`);
    await d.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-4000-8000-0000000000c1'`);
    expect((await d.query(`SELECT * FROM public.application_reviews`)).rows.length).toBe(0);
    await d.exec(`SET request.jwt.claim.sub='${U}'`);
    expect((await d.query(`SELECT * FROM public.application_reviews`)).rows.length).toBe(1);
    await d.exec(`RESET ROLE`); await d.exec(read("0142_application_reviews.undo.sql"));
    expect((await d.query(`SELECT to_regclass('public.application_reviews') r`)).rows[0]).toEqual({ r: null });
  });
});
