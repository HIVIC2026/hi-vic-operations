// Decision 293: the "A5 – Electrical fixes" template column proven on a practice Postgres (PGlite), never the live database:
// docs/pending-migrations/mitti-fixes-template.sql adds a nullable text column, is idempotent, never resets a saved id,
// and rolls back cleanly; before it is applied the code reads "pending" and fails closed (no form, office item).
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
  create table public.workflow_settings(id int primary key, customer_comms_enabled boolean not null default false, updated_at timestamptz not null default now());
  insert into public.workflow_settings(id) values (1);
`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const { readFixesTemplate } = await import("../src/lib/fixes-day.server");
const MIGRATION = readFileSync("docs/pending-migrations/mitti-fixes-template.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/mitti-fixes-template.rollback.sql", "utf8");

describe("pending migration mitti-fixes-template.sql on PGlite", () => {
  test("before: the column is missing and the code reads pending (fail closed)", async () => {
    expect(await readFixesTemplate()).toEqual({ templateId: null, pending: true });
  });
  test("adds a nullable text column, idempotent, NULL = not set up", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await readFixesTemplate()).toEqual({ templateId: null, pending: false });
  });
  test("a saved id is read back and never reset by re-applying", async () => {
    await db.exec("update public.workflow_settings set mitti_fixes_template_id = 'template_abc' where id = 1");
    expect(await readFixesTemplate()).toEqual({ templateId: "template_abc", pending: false });
    await db.exec(MIGRATION);
    expect(await readFixesTemplate()).toEqual({ templateId: "template_abc", pending: false });
    await db.exec("update public.workflow_settings set mitti_fixes_template_id = '   ' where id = 1");
    expect((await readFixesTemplate()).templateId).toBeNull(); // blank = not set up
  });
  test("rollback removes the column and the code is pending again", async () => {
    await db.exec(ROLLBACK);
    const cols = await db.query("select column_name from information_schema.columns where table_name = 'workflow_settings' and column_name = 'mitti_fixes_template_id'");
    expect(cols.rows).toEqual([]);
    expect(await readFixesTemplate()).toEqual({ templateId: null, pending: true });
  });
});
