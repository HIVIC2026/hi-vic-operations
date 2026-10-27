// Decision 412: offer records (with pay) are readable by the office and the offered business's owner only — not its
// workers, not another business. Runs the pending SQL and its undo on PGlite with the real is_admin/is_business_member.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const M = (f: string) => readFileSync(f, "utf8");
function fn(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  const re = /\$[A-Za-z_]*\$/g; re.lastIndex = start; const open = re.exec(sql)!;
  const close = sql.indexOf(open[0], open.index + open[0].length);
  return sql.slice(start, sql.indexOf(";", close) + 1);
}
const CORE = M("drizzle/migrations/0000_hivic_core_schema.sql"), P23 = M("drizzle/migrations/0023_reinsulate_pilot_partner_network.sql");
const U = { office: "00000000-0000-4000-8000-000000000001", boss: "00000000-0000-4000-8000-000000000002", worker: "00000000-0000-4000-8000-000000000003", otherBoss: "00000000-0000-4000-8000-000000000004", profileWorker: "00000000-0000-4000-8000-000000000005" };
const BIZ = { a: "00000000-0000-4000-8000-0000000000b1", b: "00000000-0000-4000-8000-0000000000b2" };

async function db() {
  const d = new PGlite();
  await d.exec(`
    CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.app_role as enum ('admin','electrician','installer','owner','property_manager');
    CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
    CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean default true);
    CREATE TABLE public.profiles (id uuid primary key, business_id uuid);
    CREATE TABLE public.partner_offers (id serial primary key, business_id uuid, summary jsonb);
  `);
  for (const s of [fn(CORE, "has_role"), fn(CORE, "is_admin"), fn(P23, "is_business_member")]) await d.exec(s);
  await d.exec(`
    GRANT USAGE ON SCHEMA auth, public TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;
    GRANT SELECT ON public.partner_offers TO authenticated; ALTER TABLE public.partner_offers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Admins or offered business read offers" ON public.partner_offers FOR SELECT TO authenticated USING (public.is_admin() OR public.is_business_member(business_id));
    INSERT INTO public.user_roles VALUES ('${U.office}','admin');
    INSERT INTO public.business_members VALUES ('${BIZ.a}','${U.boss}','business_admin',true), ('${BIZ.a}','${U.worker}','member',true), ('${BIZ.b}','${U.otherBoss}','business_admin',true);
    INSERT INTO public.profiles VALUES ('${U.profileWorker}','${BIZ.a}');
    INSERT INTO public.partner_offers (business_id, summary) VALUES ('${BIZ.a}', '{"electrician_rate_inc_gst":220}');
  `);
  return d;
}
async function seen(d: PGlite, user: string) {
  await d.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${user}', false); SET ROLE authenticated;`);
  const r = await d.query<{ n: number }>("select count(*)::int n from public.partner_offers");
  await d.exec("RESET ROLE;");
  return r.rows[0]!.n;
}

describe("Offer records: office and business owner only (decision 412)", () => {
  test("before: a worker can read the offer and its pay", async () => {
    const d = await db();
    expect(await seen(d, U.worker)).toBe(1);
    expect(await seen(d, U.profileWorker)).toBe(1);
  });
  test("after: office and owner yes; workers and other businesses no", async () => {
    const d = await db();
    await d.exec(M("docs/pending-migrations/offer-money-boss-only.sql"));
    expect(await seen(d, U.office)).toBe(1);
    expect(await seen(d, U.boss)).toBe(1);
    expect(await seen(d, U.worker)).toBe(0);
    expect(await seen(d, U.profileWorker)).toBe(0);
    expect(await seen(d, U.otherBoss)).toBe(0);
  });
  test("undo restores the old rule", async () => {
    const d = await db();
    await d.exec(M("docs/pending-migrations/offer-money-boss-only.sql"));
    await d.exec(M("docs/pending-migrations/offer-money-boss-only.undo.sql"));
    expect(await seen(d, U.worker)).toBe(1);
    expect(await seen(d, U.otherBoss)).toBe(0);
  });
});
