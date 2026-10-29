// Email delivery result (what the receiving mail server did) on sent emails: delivery_result / delivery_detail /
// delivery_at on customer_email_sends and job_communications, a check allowing only 'delivered' or 'bounced', and a
// provider_message_id lookup index on each. The migration is additive and idempotent; the rollback drops what it added.
// Fixture holds just the two tables as drizzle 0000 and later migrations leave them (only the columns this touches).
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const TABLES = ["customer_email_sends", "job_communications"];
const COLUMNS = ["delivery_result", "delivery_detail", "delivery_at"];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.customer_email_sends (id uuid primary key default gen_random_uuid(), provider_message_id text);
    CREATE TABLE public.job_communications (id uuid primary key default gen_random_uuid(), provider_message_id text);`);
  return db;
}
const cols = async (db: PGlite, table: string) =>
  (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2)`, [table, COLUMNS])).rows.map(r => r.column_name).sort();
const setResult = (db: PGlite, table: string, v: string) => db.query(`INSERT INTO public.${table} (delivery_result) VALUES ($1)`, [v]);

test("the drizzle folder no longer carries the delivery result migration", () => {
  expect(() => readFileSync(new URL("../drizzle/migrations/0178_email_delivery_result.sql", import.meta.url))).toThrow();
});

test("after (run twice): both tables take 'delivered' and 'bounced', reject anything else, and have the lookup index", async () => {
  const db = await fixture();
  await db.exec(read("email-delivery-result.sql"));
  await db.exec(read("email-delivery-result.sql"));
  for (const t of TABLES) {
    expect(await cols(db, t)).toEqual([...COLUMNS].sort());
    await setResult(db, t, "bounced");
    await setResult(db, t, "delivered");
    await db.query(`INSERT INTO public.${t} (provider_message_id) VALUES ('m1')`); // null result is fine
    await expect(setResult(db, t, "sent")).rejects.toThrow(new RegExp(`${t}_delivery_result_check`));
    const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = '${t}_provider_message_id_idx'`);
    expect(idx.rows).toHaveLength(1);
  }
  await db.close();
});

test("rollback removes the columns, checks and indexes, and can be run twice", async () => {
  const db = await fixture();
  await db.exec(read("email-delivery-result.sql"));
  await db.exec(read("email-delivery-result.rollback.sql"));
  await db.exec(read("email-delivery-result.rollback.sql"));
  for (const t of TABLES) {
    expect(await cols(db, t)).toEqual([]);
    const left = await db.query(`SELECT 1 FROM pg_constraint WHERE conname = '${t}_delivery_result_check' UNION ALL SELECT 1 FROM pg_indexes WHERE indexname = '${t}_provider_message_id_idx'`);
    expect(left.rows).toHaveLength(0);
  }
  await db.exec(read("email-delivery-result.sql")); // and it re-applies cleanly
  await db.close();
});
