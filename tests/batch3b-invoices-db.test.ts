// Practice database proof: fixes and repeat safety check invoices next to the install one (pending SQL, not run live).
import { test, expect, beforeEach } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { makeInvoicesDb, applySeparateInvoices, rollbackSeparateInvoices, pending, jobOverview0055, invoiceStatus0079 } from "./helpers/pglite-separate-invoices";

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

// ---- Final fix wave: a voided old fixes invoice is closed; job_overview follows the installation invoice ----
const statusOf = async (id: string) => (await db.query<{ effective_status: string }>(`SELECT effective_status::text FROM public.invoice_status WHERE id = $1`, [id])).rows[0]!.effective_status;
const jobPayment = async (jobId = job) => (await db.query<{ payment_status: string | null }>(`SELECT payment_status FROM public.job_overview WHERE id = $1`, [jobId])).rows[0]?.payment_status ?? null;
const viewCols = async (name: string) => (await db.query<{ column_name: string; data_type: string }>(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [name])).rows;
async function seedOverviewJob() {
  const owner = await uuid("owners"), prop = await uuid("properties");
  await db.query(`UPDATE public.jobs SET job_number = 'HV-0101', owner_id = $2, property_id = $3 WHERE id = $1`, [job, owner, prop]);
}

test("I1: a voided old fixes invoice reads 'voided' — never overdue or deposit due", async () => {
  const id = (await db.query<{ id: string }>(
    `INSERT INTO public.invoices (job_id, quote_id, kind, status, total_inc_gst, deposit_amount, balance_amount, deposit_due_date)
     VALUES ($1, $2, 'rectification', 'deposit_due', 550, 550, 0, CURRENT_DATE - 30) RETURNING id`, [job, quoteB])).rows[0]!.id;
  expect(await statusOf(id)).toBe("overdue"); // before: shows owing
  await db.query(`UPDATE public.invoices SET status = 'voided' WHERE id = $1`, [id]);
  expect(await statusOf(id)).toBe("voided");
  expect((await db.query(`SELECT 1 FROM public.invoice_status WHERE job_id = $1 AND effective_status::text = 'overdue'`, [job])).rows).toEqual([]);
});

test("I2: job_overview payment status follows the installation invoice, not a newer fixes invoice; same columns and grants", async () => {
  await seedOverviewJob();
  await db.query(`UPDATE public.invoices SET status = 'deposit_due', created_at = now() - interval '2 days', total_paid = 3490 WHERE kind = 'installation'`);
  await db.query(`INSERT INTO public.invoices (job_id, quote_id, kind, total_inc_gst, deposit_amount, balance_amount, deposit_due_date) VALUES ($1, $2, 'rectification', 550, 550, 0, CURRENT_DATE - 30)`, [job, quoteB]);
  await insert("repeat_safety_check", null, "reopen:k");
  expect(await jobPayment()).toBe("fully_paid");
  const fresh = await makeInvoicesDb();
  const before = (await fresh.query<{ column_name: string; data_type: string }>(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'job_overview' ORDER BY ordinal_position`)).rows;
  expect(await viewCols("job_overview")).toEqual(before);
  expect((await db.query<{ ok: boolean }>(`SELECT has_table_privilege('authenticated', 'public.job_overview', 'SELECT') AS ok`)).rows[0]!.ok).toBe(true);
  expect((await db.query<{ ok: boolean }>(`SELECT has_table_privilege('authenticated', 'public.invoice_status', 'SELECT') AS ok`)).rows[0]!.ok).toBe(true);
});

test("I2: the pending job_overview is the latest (0055) definition with only the installation filter added", () => {
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const sql = pending("separate-invoices.sql");
  const mine = sql.match(/CREATE OR REPLACE VIEW public\.job_overview[\s\S]*?;/)?.[0] ?? "";
  expect(norm(mine)).toBe(norm(jobOverview0055().replace("WHERE p.job_id = j.id ORDER BY", "WHERE p.job_id = j.id AND p.kind = 'installation'::quote_kind ORDER BY")));
  const rb = pending("separate-invoices.rollback.sql");
  expect(norm(rb)).toContain(norm(jobOverview0055()));
  expect(norm(rb)).toContain(norm(invoiceStatus0079()));
});

test("rollback puts both views back: payment status follows the newest invoice again, a voided row reads as before", async () => {
  await seedOverviewJob();
  await db.query(`UPDATE public.invoices SET status = 'deposit_due', created_at = now() - interval '2 days', total_paid = 3490 WHERE kind = 'installation'`);
  const fx = (await db.query<{ id: string }>(`INSERT INTO public.invoices (job_id, quote_id, kind, status, total_inc_gst, deposit_amount, balance_amount, deposit_due_date) VALUES ($1, $2, 'rectification', 'voided', 550, 550, 0, CURRENT_DATE - 30) RETURNING id`, [job, quoteB])).rows[0]!.id;
  await rollbackSeparateInvoices(db);
  expect(await jobPayment()).toBe("overdue");
  expect(await statusOf(fx)).toBe("overdue");
  expect((await db.query<{ status: string }>(`SELECT status::text FROM public.invoices WHERE id = $1`, [fx])).rows[0]!.status).toBe("deposit_due");
  expect((await db.query<{ ok: boolean }>(`SELECT has_table_privilege('authenticated', 'public.job_overview', 'SELECT') AS ok`)).rows[0]!.ok).toBe(true);
});

test("the whole pending file also runs as one transaction (new enum values are not used as literals)", async () => {
  const fresh = await makeInvoicesDb();
  await fresh.exec(`BEGIN;\n${pending("separate-invoices.sql")}\nCOMMIT;`);
  const vals = (await fresh.query<{ v: string }>(`SELECT unnest(enum_range(NULL::public.payment_status))::text AS v`)).rows.map((r) => r.v);
  expect(vals).toContain("voided");
});
