// Practice database proof for 0111: additive columns only, existing quotes unchanged, rollback clean.
import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");

test("0111 adds whole-VEEC columns without touching existing quotes, and rolls back", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.quotes (id serial primary key, veec_discount_inc_gst numeric(10,2) not null default 0, discount_note text);
    INSERT INTO public.quotes (veec_discount_inc_gst) VALUES (1481.76), (900);`);
  const before = (await db.query("SELECT * FROM public.quotes ORDER BY id")).rows;
  await db.exec(read("0111_quote_veec_count.sql"));
  await db.exec(read("0111_quote_veec_count.sql")); // idempotent
  const after = (await db.query<Record<string, unknown>>("SELECT * FROM public.quotes ORDER BY id")).rows;
  expect(after.map(({ veec_count, veec_unit_value_inc_gst, ...r }) => { expect(veec_count).toBeNull(); expect(veec_unit_value_inc_gst).toBeNull(); return r; })).toEqual(before);
  await db.exec("INSERT INTO public.quotes (veec_discount_inc_gst, veec_count, veec_unit_value_inc_gst) VALUES (1470, 21, 70)");
  expect((await db.query("SELECT veec_count FROM public.quotes WHERE id=3")).rows[0]).toEqual({ veec_count: 21 });
  await db.exec(read("0111_quote_veec_count.rollback.sql"));
  const cols = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='quotes'")).rows.map((r) => r.column_name);
  expect(cols).not.toContain("veec_count");
  expect((await db.query("SELECT count(*)::int n FROM public.quotes")).rows[0]).toEqual({ n: 3 });
});
