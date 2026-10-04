// Practice database (PGlite) for 0102 profit card. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE public.workflow_settings (id int primary key, customer_comms_enabled boolean default false);
    CREATE TABLE public.veec_lodgements (id uuid primary key, quantity numeric, status text);
    INSERT INTO workflow_settings VALUES (1, false); INSERT INTO veec_lodgements VALUES ('20000000-0000-4000-8000-000000000001', 20, 'submitted');`);
  await db.exec(read("0102_profit_card.sql"));
});
describe("0102 profit card (practice database)", () => {
  test("existing rows unchanged, price starts at $83, sale price empty; rerun safe", async () => {
    await db.exec(read("0102_profit_card.sql"));
    expect((await db.query(`SELECT customer_comms_enabled, current_veec_price::text p FROM workflow_settings`)).rows).toEqual([{ customer_comms_enabled: false, p: "83.00" }]);
    expect((await db.query(`SELECT quantity::int q, status, sale_price_per_veec FROM veec_lodgements`)).rows).toEqual([{ q: 20, status: "submitted", sale_price_per_veec: null }]);
  });
  test("bad prices refused", async () => {
    await expect(db.exec(`UPDATE workflow_settings SET current_veec_price = 0`)).rejects.toThrow();
    await expect(db.exec(`UPDATE veec_lodgements SET sale_price_per_veec = -1`)).rejects.toThrow();
  });
  test("undo removes only the new fields", async () => {
    await db.exec(read("0102_profit_card.rollback.sql"));
    expect((await db.query(`SELECT count(*)::int n FROM veec_lodgements`)).rows).toEqual([{ n: 1 }]);
  });
});
