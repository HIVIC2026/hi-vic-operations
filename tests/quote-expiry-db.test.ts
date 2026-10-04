// Practice database (PGlite) re-proof of step 5 (quote expiry columns + 'expired' status). Fake rows only.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const BASE = `
CREATE TYPE public.quote_status AS ENUM ('draft','issued','accepted','declined','superseded');
CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid(), job_id uuid not null, kind text not null, status public.quote_status not null default 'draft', created_at timestamptz not null default now());
INSERT INTO quotes (job_id, kind, status, created_at) VALUES
 (gen_random_uuid(),'installation','issued', now() - interval '30 days'),
 (gen_random_uuid(),'installation','accepted', now() - interval '5 days'),
 (gen_random_uuid(),'rectification','issued', now() - interval '20 days');`;

const snap = async (db: PGlite) => (await db.query(`SELECT id, job_id, kind, status::text, created_at::text FROM quotes ORDER BY id`)).rows;

describe("0092 quote expiry (practice database)", () => {
  test("additive: existing rows unchanged, new columns empty, no backfill", async () => {
    const db = new PGlite(); await db.exec(BASE);
    const before = await snap(db);
    await db.exec(read("0092_quote_expiry_nudges.sql"));
    expect(await snap(db)).toEqual(before);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int n FROM quotes WHERE sent_at IS NOT NULL OR nudge_day3_at IS NOT NULL OR nudge_day10_at IS NOT NULL OR expired_at IS NOT NULL`);
    expect(r.rows[0]!.n).toBe(0);
  });
  test("'expired' status is usable afterwards and the script is safe to re-run", async () => {
    const db = new PGlite(); await db.exec(BASE);
    await db.exec(read("0092_quote_expiry_nudges.sql"));
    await db.exec(read("0092_quote_expiry_nudges.sql"));
    await db.exec(`INSERT INTO quotes (job_id, kind, status, sent_at, expired_at) VALUES (gen_random_uuid(),'installation','expired', now() - interval '15 days', now())`);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int n FROM quotes WHERE status = 'expired'`);
    expect(r.rows[0]!.n).toBe(1);
  });
  test("rollback removes the new columns and leaves the old rows intact", async () => {
    const db = new PGlite(); await db.exec(BASE);
    const before = await snap(db);
    await db.exec(read("0092_quote_expiry_nudges.sql"));
    await db.exec(read("0092_quote_expiry_nudges.rollback.sql"));
    expect(await snap(db)).toEqual(before);
    const c = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'quotes' AND column_name IN ('sent_at','nudge_day3_at','nudge_day10_at','expired_at')`);
    expect(c.rows.length).toBe(0);
  });
});
