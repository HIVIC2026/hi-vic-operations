// Mitti instant-notice switch proven on a practice Postgres (PGlite), never the live database:
// apply adds the column OFF by default, re-running is safe, rollback removes it.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create table public.workflow_settings(id int primary key, mitti_pickup_auto_enabled boolean not null default false, updated_at timestamptz not null default now());
  insert into public.workflow_settings(id) values (1);
`);
const MIGRATION = readFileSync("docs/pending-migrations/mitti-instant-notice-switch.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/mitti-instant-notice-switch.rollback.sql", "utf8");
const cols = async () => (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'workflow_settings' and column_name = 'mitti_instant_notice_enabled'")).rows;

describe("pending migration mitti-instant-notice-switch.sql on PGlite", () => {
  test("column is absent before apply", async () => {
    expect(await cols()).toHaveLength(0);
  });
  test("apply adds the column, default false for the existing row", async () => {
    await db.exec(MIGRATION);
    expect(await cols()).toHaveLength(1);
    const r = await db.query<{ v: boolean }>("select mitti_instant_notice_enabled as v from public.workflow_settings where id = 1");
    expect(r.rows[0]!.v).toBe(false);
  });
  test("re-running apply is safe and keeps a switched-on value", async () => {
    await db.exec("update public.workflow_settings set mitti_instant_notice_enabled = true where id = 1");
    await db.exec(MIGRATION);
    const r = await db.query<{ v: boolean }>("select mitti_instant_notice_enabled as v from public.workflow_settings where id = 1");
    expect(r.rows[0]!.v).toBe(true);
  });
  test("rollback removes the column and is safe to repeat", async () => {
    await db.exec(ROLLBACK);
    expect(await cols()).toHaveLength(0);
    await db.exec(ROLLBACK);
    expect(await cols()).toHaveLength(0);
  });
});
