// Practice-database proof for 0123 (PGlite, never touches the live database).
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL = readFileSync(new URL("../docs/pending-migrations/0123_partner_profile.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/pending-migrations/0123_partner_profile.rollback.sql", import.meta.url), "utf8");
const BASE = `
CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.rec_onboarding_applications (id uuid primary key default gen_random_uuid(), status text not null default 'draft');
CREATE TABLE public.businesses (id uuid primary key default gen_random_uuid(), name text not null);
`;

describe("0123 partner profile (practice database)", () => {
  test("applies, is re-runnable, test marks are permanent, rollback is clean", async () => {
    const db = new PGlite();
    await db.exec(BASE);
    await db.exec(SQL);
    await db.exec(SQL); // idempotent
    const { rows: [app] } = await db.query<{ id: string }>("insert into rec_onboarding_applications(status) values ('submitted') returning id");
    await db.query("insert into onboarding_test_marks(application_id, reason) values ($1, 'Jo test')", [app!.id]);
    await expect(db.query("insert into onboarding_test_marks(application_id, reason) values ($1, 'again')", [app!.id])).rejects.toThrow();
    await expect(db.query("update onboarding_test_marks set reason='x real' where application_id=$1", [app!.id])).rejects.toThrow(/permanent/);
    await expect(db.query("delete from onboarding_test_marks where application_id=$1", [app!.id])).rejects.toThrow(/permanent/);
    await expect(db.query("insert into onboarding_test_marks(application_id, reason) values (gen_random_uuid(), 'no app')")).rejects.toThrow();
    await db.query("insert into businesses(name, coverage_lat, coverage_lng, coverage_radius_km, approval_message_status) values ('B', -37.8, 144.9, 50, 'queued')");
    await expect(db.query("update businesses set approval_message_status='emailed'")).rejects.toThrow();
    await db.exec(ROLLBACK);
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from information_schema.columns where table_name='businesses'");
    expect(rows[0]!.n).toBe(2);
  });
});
