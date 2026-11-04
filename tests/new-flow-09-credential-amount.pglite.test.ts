// New job flow Part 9 Task 8: `business_credentials.amount_insured_aud` (the public liability amount the office types when
// it approves the certificate) proven on a practice Postgres (PGlite), never the live database: the column is added null,
// the migration is idempotent, a negative amount is refused, and the rollback removes the column cleanly.
import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create table public.businesses(id uuid primary key default gen_random_uuid(), name text not null);
  create table public.business_credentials(id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), kind text not null, label text not null,
    expires_at date, verification text not null default 'pending');
  insert into public.businesses(id, name) values ('00000000-0000-4000-8000-0000000000b1', 'Rapid Insulation');
  insert into public.business_credentials(id, business_id, kind, label, expires_at, verification)
    values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'public_liability_insurance', 'Public liability', '2027-06-30', 'verified');
`);
const MIGRATION = readFileSync("docs/pending-migrations/2026-11-02-credential-amount-insured.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/2026-11-02-credential-amount-insured.rollback.sql", "utf8");
const CRED = "00000000-0000-4000-8000-0000000000c1";
const column = async () => (await db.query<{ data_type: string; is_nullable: string }>("select data_type, is_nullable from information_schema.columns where table_name = 'business_credentials' and column_name = 'amount_insured_aud'")).rows;
const amount = async () => (await db.query<{ v: string | null }>("select amount_insured_aud::text v from public.business_credentials where id = $1", [CRED])).rows[0]!.v;
afterAll(async () => { await db.close(); });

describe("pending migration 2026-11-02-credential-amount-insured.sql", () => {
  test("adds a nullable numeric amount_insured_aud; existing rows get null (= not recorded, blocked); idempotent", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await column()).toEqual([{ data_type: "numeric", is_nullable: "YES" }]);
    expect(await amount()).toBeNull();
  });
  test("the office records the amount on the verified row; a negative amount is refused", async () => {
    await db.query("update public.business_credentials set amount_insured_aud = 5000000 where id = $1", [CRED]);
    expect(await amount()).toBe("5000000");
    await expect(db.query("update public.business_credentials set amount_insured_aud = -1 where id = $1", [CRED])).rejects.toThrow(/amount_insured_aud/);
    expect(await amount()).toBe("5000000");
  });
  test("rollback removes the column and its check; the rows stay; the migration applies again", async () => {
    await db.exec(ROLLBACK);
    expect(await column()).toHaveLength(0);
    expect((await db.query("select conname from pg_constraint where conname = 'business_credentials_amount_insured_aud_check'")).rows).toHaveLength(0);
    expect((await db.query("select id from public.business_credentials")).rows).toHaveLength(1);
    await db.exec(MIGRATION);
    expect(await amount()).toBeNull();
  });
});
