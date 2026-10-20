// Practice database (PGlite) proof for 0209: the confirm lease lets exactly one confirm work a row; an expired lease
// can be taken again; rows stay pending until finished; rollback removes only the new columns.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bulkDb, ID } from "./helpers/pglite-bulk-import";

const UP = readFileSync("docs/pending-migrations/0209_bulk_import_confirm_lease.sql", "utf8");
const DOWN = readFileSync("docs/pending-migrations/0209_bulk_import_confirm_lease.rollback.sql", "utf8");
const CLAIM = `UPDATE public.bulk_import_rows SET confirm_lease_until = now() + interval '5 minutes'
  WHERE id = $1 AND status = 'pending' AND (confirm_lease_until IS NULL OR confirm_lease_until < now()) RETURNING id`;

async function setup() {
  const db = await bulkDb();
  await db.exec(UP); await db.exec(UP); // idempotent
  const b = await db.query<{ id: string }>(`INSERT INTO public.bulk_import_batches(business_id, created_by) VALUES ($1,$2) RETURNING id`, [ID.biz, ID.installer]);
  const r = await db.query<{ id: string }>(`INSERT INTO public.bulk_import_rows(batch_id,row_index,extracted,sort_result) VALUES ($1,0,'{}','covers_ready_check') RETURNING id`, [b.rows[0]!.id]);
  return { db, rowId: r.rows[0]!.id };
}

test("only one confirm can hold a row; the second gets nothing", async () => {
  const { db, rowId } = await setup();
  expect((await db.query(CLAIM, [rowId])).rows.length).toBe(1);
  expect((await db.query(CLAIM, [rowId])).rows.length).toBe(0);
});

test("a failed attempt keeps the row pending with its reason, and it can be claimed again", async () => {
  const { db, rowId } = await setup();
  await db.query(CLAIM, [rowId]);
  await db.query(`UPDATE public.bulk_import_rows SET confirm_lease_until = NULL, confirm_error = 'Measure-up could not be saved' WHERE id = $1`, [rowId]);
  const row = (await db.query<{ status: string; confirm_error: string }>(`SELECT status, confirm_error FROM public.bulk_import_rows WHERE id=$1`, [rowId])).rows[0]!;
  expect(row).toEqual({ status: "pending", confirm_error: "Measure-up could not be saved" });
  expect((await db.query(CLAIM, [rowId])).rows.length).toBe(1);
});

test("an expired lease (crashed attempt) can be taken over; a confirmed row never can", async () => {
  const { db, rowId } = await setup();
  await db.query(`UPDATE public.bulk_import_rows SET confirm_lease_until = now() - interval '1 minute' WHERE id=$1`, [rowId]);
  expect((await db.query(CLAIM, [rowId])).rows.length).toBe(1);
  await db.query(`UPDATE public.bulk_import_rows SET status='confirmed', confirm_lease_until=NULL WHERE id=$1`, [rowId]);
  expect((await db.query(CLAIM, [rowId])).rows.length).toBe(0);
});

test("rollback removes only the two new columns", async () => {
  const { db } = await setup();
  await db.exec(DOWN);
  const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='bulk_import_rows'`)).rows.map((r) => r.column_name);
  expect(cols).not.toContain("confirm_lease_until");
  expect(cols).not.toContain("confirm_error");
  expect(cols).toContain("status");
});
