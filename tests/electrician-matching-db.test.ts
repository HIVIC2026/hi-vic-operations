// Practice database (PGlite) proof for 0094: additive, existing rows unchanged, rollback clean.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const BASE = `
CREATE TABLE public.businesses (id uuid primary key, name text not null);
CREATE TABLE public.workflow_settings (id integer primary key default 1, rec_offer_expiry_hours numeric default 2, rec_offer_batch_size integer default 3);
CREATE TABLE public.partner_offers (id uuid primary key, expires_at timestamptz);
INSERT INTO public.businesses VALUES ('10000000-0000-4000-8000-000000000001','TEST Delta Electrical');
INSERT INTO public.workflow_settings (id) VALUES (1);
INSERT INTO public.partner_offers VALUES ('20000000-0000-4000-8000-000000000001','2026-10-05T01:00:00Z');`;

describe("0094 electrician matching (practice database)", () => {
  test("adds empty limit + 4h default; existing rows and offers unchanged; rerun safe; rollback clean", async () => {
    const db = new PGlite();
    await db.exec(BASE);
    await db.exec(read("0094_electrician_matching.sql"));
    await db.exec(read("0094_electrician_matching.sql")); // idempotent
    const b = await db.query<{ name: string; daily_job_limit: number | null }>("select name, daily_job_limit from businesses");
    expect(b.rows).toEqual([{ name: "TEST Delta Electrical", daily_job_limit: null }]);
    const s = await db.query<{ h: string; old: string }>("select rec_offer_business_hours::text h, rec_offer_expiry_hours::text old from workflow_settings");
    expect(s.rows[0]).toEqual({ h: "4", old: "2" });
    const o = await db.query<{ e: string }>("select expires_at::text e from partner_offers");
    expect(o.rows[0]!.e).toContain("2026-10-05");
    await expect(db.exec("update businesses set daily_job_limit = 0")).rejects.toThrow();
    await db.exec("update businesses set daily_job_limit = 3");
    await db.exec(read("0094_electrician_matching.rollback.sql"));
    const cols = await db.query("select column_name from information_schema.columns where column_name in ('daily_job_limit','rec_offer_business_hours')");
    expect(cols.rows.length).toBe(0);
  });
});
