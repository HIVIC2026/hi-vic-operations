// Practice database proof: fixes and repeat safety check invoices next to the install one (pending SQL, not run live).
import { test, expect, beforeEach } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { makeInvoicesDb, applySeparateInvoices, rollbackSeparateInvoices } from "./helpers/pglite-separate-invoices";

let db: PGlite;
let job: string;
let quoteA: string;
let quoteB: string;

const uuid = async (table: string) => ((await db.query<{ id: string }>(`INSERT INTO public.${table} DEFAULT VALUES RETURNING id`)).rows[0].id);
const insert = (kind: string, quoteId: string | null, repeatKey: string | null, jobId = job) =>
  db.query(
    `INSERT INTO public.invoices (job_id, quote_id, kind, repeat_key, total_inc_gst, deposit_amount, balance_amount)
     VALUES ($1, $2, $3::public.quote_kind, $4, 349, 349, 0) RETURNING id`,
    [jobId, quoteId, kind, repeatKey],
  );

beforeEach(async () => {
  db = await makeInvoicesDb();
  job = await uuid("jobs");
  quoteA = await uuid("quotes");
  quoteB = await uuid("quotes");
  // An install invoice that exists before the change.
  await db.query(
    `INSERT INTO public.invoices (job_id, quote_id, kind, total_inc_gst, deposit_amount, balance_amount) VALUES ($1, $2, 'installation', 3490, 349, 3141)`,
    [job, quoteA],
  );
  await applySeparateInvoices(db);
  await applySeparateInvoices(db); // re-runnable
});

test("old installation row stays valid", async () => {
  const rows = (await db.query<{ kind: string; quote_id: string; repeat_key: string | null }>(`SELECT kind, quote_id, repeat_key FROM public.invoices`)).rows;
  expect(rows).toEqual([{ kind: "installation", quote_id: quoteA, repeat_key: null }]);
  await insert("rectification", quoteB, null); // a fixes invoice on its own quote
});

test("repeat safety check row with no quote and a repeat key is allowed", async () => {
  await insert("repeat_safety_check", null, "reopen:2026-10-29T00:00:00Z");
  await insert("repeat_safety_check", null, "reopen:2026-11-30T00:00:00Z"); // a second repeat, different key
});

test("fixes (rectification) row without a quote is rejected", async () => {
  await expect(insert("rectification", null, null)).rejects.toThrow();
});

test("installation row without a quote is rejected", async () => {
  await expect(insert("installation", null, null)).rejects.toThrow();
});

test("repeat row without a repeat key is rejected", async () => {
  await expect(insert("repeat_safety_check", null, null)).rejects.toThrow();
});

test("repeat row that points at a quote is rejected", async () => {
  await expect(insert("repeat_safety_check", quoteB, "reopen:x")).rejects.toThrow();
});

test("repeat key on a non-repeat row is rejected", async () => {
  await expect(insert("rectification", quoteB, "reopen:x")).rejects.toThrow();
});

test("two repeat rows with the same job and repeat key are rejected; another job may reuse the key", async () => {
  await insert("repeat_safety_check", null, "reopen:k");
  await expect(insert("repeat_safety_check", null, "reopen:k")).rejects.toThrow();
  await insert("repeat_safety_check", null, "reopen:k", await uuid("jobs"));
});

test("a second invoice on one quote is rejected", async () => {
  await expect(insert("rectification", quoteA, null)).rejects.toThrow();
});

test("invoice_status shows the repeat row", async () => {
  await insert("repeat_safety_check", null, "reopen:k");
  const rows = (await db.query<{ kind: string; quote_id: string | null }>(`SELECT kind, quote_id FROM public.invoice_status WHERE job_id = $1 ORDER BY kind`, [job])).rows;
  expect(rows).toEqual([
    { kind: "installation", quote_id: quoteA },
    { kind: "repeat_safety_check", quote_id: null },
  ]);
});

test("rollback restores the old rules when no repeat rows exist, and refuses when they do", async () => {
  await insert("repeat_safety_check", null, "reopen:k");
  await expect(rollbackSeparateInvoices(db)).rejects.toThrow(/repeat safety check/);
  await db.query(`DELETE FROM public.invoices WHERE kind::text = 'repeat_safety_check'`);
  await rollbackSeparateInvoices(db);
  const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices'`)).rows.map((r) => r.column_name);
  expect(cols).not.toContain("repeat_key");
  const nullable = (await db.query<{ is_nullable: string }>(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'quote_id'`)).rows[0];
  expect(nullable.is_nullable).toBe("NO");
  const plain = (quoteId: string | null, kind = "rectification") =>
    db.query(`INSERT INTO public.invoices (job_id, quote_id, kind, total_inc_gst, deposit_amount, balance_amount) VALUES ($1, $2, $3::public.quote_kind, 349, 349, 0)`, [job, quoteId, kind]);
  await expect(plain(null)).rejects.toThrow(); // quote needed again
  await expect(plain(quoteA)).rejects.toThrow(); // still one invoice per quote
  await plain(quoteB);
  await applySeparateInvoices(db); // and it can go forward again
});
