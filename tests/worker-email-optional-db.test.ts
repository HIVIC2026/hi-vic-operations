// Proves docs/pending-migrations/0229_worker_email_optional.sql on PGlite (in-process; nothing live). Mirrors the live
// partner_workers email column, UNIQUE (business_id, email) and the existing worker_role check (read 28 Oct 2026).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const MIG = join(import.meta.dir, "..", "docs", "pending-migrations");
const SQL = readFileSync(join(MIG, "0229_worker_email_optional.sql"), "utf8");
const ROLLBACK = readFileSync(join(MIG, "0229_worker_email_optional.rollback.sql"), "utf8");
const B1 = "10000000-0000-4000-8000-000000000001", B2 = "10000000-0000-4000-8000-000000000002";

async function db() {
  const d = new PGlite();
  await d.exec(`
    CREATE TABLE public.partner_workers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, full_legal_name text NOT NULL, email text NOT NULL,
      mobile text, trade_role text NOT NULL, worker_role text CHECK (worker_role IS NULL OR worker_role = ANY (ARRAY['lead','crew'])),
      CONSTRAINT partner_workers_business_id_email_key UNIQUE (business_id, email));
    INSERT INTO partner_workers (business_id, full_legal_name, email, trade_role) VALUES ('${B1}', 'Existing Person', 'one@biz.com.au', 'installer');`);
  return d;
}
const add = (d: PGlite, biz: string, name: string, email: string | null) =>
  d.query(`INSERT INTO partner_workers (business_id, full_legal_name, email, mobile, trade_role) VALUES ($1, $2, $3, '0412345678', 'installer')`, [biz, name, email]);

describe("0229 worker email optional (practice database)", () => {
  test("before: a person without an email is refused", async () => {
    const d = await db();
    await expect(add(d, B1, "No Email", null)).rejects.toThrow();
  });
  test("after: name + role + mobile saves; two no-email people in one business allowed; existing row unchanged", async () => {
    const d = await db(); await d.exec(SQL); await d.exec(SQL); // safe to run twice
    await add(d, B1, "Crew One", null); await add(d, B1, "Crew Two", null);
    expect((await d.query<{ n: number }>(`SELECT count(*)::int n FROM partner_workers WHERE email IS NULL AND business_id='${B1}'`)).rows[0]!.n).toBe(2);
    expect((await d.query(`SELECT full_legal_name, email FROM partner_workers WHERE email IS NOT NULL`)).rows).toEqual([{ full_legal_name: "Existing Person", email: "one@biz.com.au" }]);
  });
  test("after: uniqueness still applies whenever an email is given; blank email refused", async () => {
    const d = await db(); await d.exec(SQL);
    await expect(add(d, B1, "Dup", "one@biz.com.au")).rejects.toThrow();
    await add(d, B2, "Other Biz", "one@biz.com.au"); // other business: allowed as before
    await expect(add(d, B1, "Blank", "  ")).rejects.toThrow();
  });
  test("Lead / Crew uses the existing worker_role check", async () => {
    const d = await db(); await d.exec(SQL);
    await d.exec(`UPDATE partner_workers SET worker_role='lead'`);
    await expect(d.exec(`UPDATE partner_workers SET worker_role='boss'`)).rejects.toThrow();
  });
  test("rollback refuses while someone has no email, then restores NOT NULL", async () => {
    const d = await db(); await d.exec(SQL); await add(d, B1, "Crew One", null);
    await expect(d.exec(ROLLBACK)).rejects.toThrow(/no email/);
    await d.exec(`DELETE FROM partner_workers WHERE email IS NULL`);
    await d.exec(ROLLBACK);
    await expect(add(d, B1, "No Email", null)).rejects.toThrow();
  });
});
