// Proves 0230 on PGlite after 0229 (nothing live). Table mirrors tests/worker-email-optional-db.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
const MIG = join(import.meta.dir, "..", "docs", "pending-migrations");
const read = (f: string) => readFileSync(join(MIG, f), "utf8");
const B1 = "10000000-0000-4000-8000-000000000001";
async function db() {
  const d = new PGlite();
  await d.exec(`CREATE TABLE public.partner_workers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, full_legal_name text NOT NULL, email text NOT NULL,
    mobile text, trade_role text NOT NULL, worker_role text CHECK (worker_role IS NULL OR worker_role = ANY (ARRAY['lead','crew'])),
    CONSTRAINT partner_workers_business_id_email_key UNIQUE (business_id, email));
    INSERT INTO partner_workers (business_id, full_legal_name, email, trade_role) VALUES ('${B1}', 'Old', 'old@biz.com.au', 'installer');`);
  await d.exec(read("0229_worker_email_optional.sql"));
  return d;
}
const add = (d: PGlite, name: string, role: string | null, due?: boolean) =>
  d.query(`INSERT INTO partner_workers (business_id, full_legal_name, email, trade_role, worker_role${due === undefined ? "" : ", declarations_due"}) VALUES ($1, $2, NULL, 'installer', $3${due === undefined ? "" : ", $4"})`, due === undefined ? [B1, name, role] : [B1, name, role, due]);

describe("0230 declarations_due (practice database)", () => {
  test("existing rows read false; a Team add can be true; safe to run twice", async () => {
    const d = await db(); const sql = read("0230_team_declarations_due.sql");
    await d.exec(sql); await d.exec(sql);
    await add(d, "New", "crew", true);
    expect((await d.query(`SELECT full_legal_name, declarations_due FROM partner_workers ORDER BY full_legal_name`)).rows).toEqual([{ full_legal_name: "New", declarations_due: true }, { full_legal_name: "Old", declarations_due: false }]);
  });
  test("the existing worker_role check allows only null, lead and crew; 0230 adds no second one", async () => {
    const d = await db(); await d.exec(read("0230_team_declarations_due.sql"));
    await add(d, "L", "lead"); await add(d, "C", "crew"); await add(d, "N", null);
    await expect(add(d, "B", "boss")).rejects.toThrow();
    const n = await d.query<{ n: number }>(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'partner_workers'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%worker_role%'`);
    expect(n.rows[0]!.n).toBe(1);
    expect(read("0230_team_declarations_due.sql")).not.toMatch(/DROP NOT NULL|worker_role/);
  });
  test("rollback drops only declarations_due", async () => {
    const d = await db(); await d.exec(read("0230_team_declarations_due.sql")); await d.exec(read("0230_team_declarations_due.rollback.sql"));
    const cols = (await d.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'partner_workers'`)).rows.map((r) => r.column_name);
    expect(cols).not.toContain("declarations_due");
    expect(cols).toContain("worker_role");
  });
});
