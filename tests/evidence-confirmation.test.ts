import { afterAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import { evidencePathId, persistEvidenceConfirmation } from "../src/lib/evidence-confirmation.server";

const db = new PGlite();
await db.exec(`CREATE TABLE evidence_files (id uuid PRIMARY KEY, requirement_id uuid NOT NULL, job_id uuid NOT NULL, storage_path text NOT NULL, file_name text, captured_at timestamptz, location_source text);
CREATE TABLE evidence_requirements (id uuid PRIMARY KEY, status text, verified_by uuid, verified_at timestamptz);`);
const req = "11111111-1111-4111-8111-111111111111", job = "22222222-2222-4222-8222-222222222222";
const file = { requirement_id: req, job_id: job, storage_path: `${job}/measurement/stored.pdf`, file_name: "TEST.pdf", captured_at: null, location_source: "not_required" };
let failure: "insert" | "update" | "read" | null = null;
// PostgREST-shaped adapter executes the real helper's queries against PostgreSQL; no network or device evidence.
const client = { from(table: string) {
  let op = "read", cols = "*", values: Record<string, unknown> = {}, filters: [string, unknown][] = [], single = false;
  const q = {
    select(c: string) { cols = c; return q; },
    insert(v: Record<string, unknown>) { op = "insert"; values = v; return q; },
    update(v: Record<string, unknown>) { op = "update"; values = v; return q; },
    eq(k: string, v: unknown) { filters.push([k, v]); return q; },
    single() { single = true; return q; },
    then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) {
      return (async () => {
        if (failure === op) { failure = null; return { data: null, error: { code: "XX000", message: `injected ${op} failure` } }; }
        const args: unknown[] = [], param = (v: unknown) => { args.push(v); return `$${args.length}`; };
        let sql = `SELECT ${cols} FROM ${table}`;
        if (op === "insert") sql = `INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.values(values).map(param).join(",")})`;
        if (op === "update") sql = `UPDATE ${table} SET ${Object.entries(values).map(([k,v]) => `${k}=${param(v)}`).join(",")}`;
        if (filters.length) sql += ` WHERE ${filters.map(([k,v]) => `${k}=${param(v)}`).join(" AND ")}`;
        if (op === "update") sql += ` RETURNING ${cols}`;
        try { const r = await db.query(sql, args); return { data: single ? r.rows[0] ?? null : r.rows, error: null }; }
        catch (e) { const err = e as { code: string; message: string }; return { data: null, error: { code: err.code, message: err.message } }; }
      })().then(resolve, reject);
    },
  }; return q;
} } as unknown as SupabaseClient<Database>;
const count = async () => Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM evidence_files")).rows[0]?.n);
const status = async () => (await db.query<{ status: string }>("SELECT status FROM evidence_requirements")).rows[0]?.status;
beforeEach(async () => { failure = null; await db.exec("TRUNCATE evidence_files,evidence_requirements"); await db.query("INSERT INTO evidence_requirements(id,status) VALUES ($1,'outstanding')", [req]); });
afterAll(async () => { await db.close(); });

test("file insert failure rejects confirmation, leaves outstanding and retries successfully", async () => {
  failure = "insert"; let after = 0;
  await expect(persistEvidenceConfirmation(client, file, async () => { after++; })).rejects.toThrow("injected insert failure");
  expect(await count()).toBe(0); expect(await status()).toBe("outstanding"); expect(after).toBe(0);
  expect(await persistEvidenceConfirmation(client, file, async () => {})).toEqual({ ok: true }); expect(await count()).toBe(1);
});
test("status failure retains the stored file and same-path retry creates no duplicate", async () => {
  failure = "update";
  await expect(persistEvidenceConfirmation(client, file, async () => {})).rejects.toThrow("injected update failure");
  expect(await count()).toBe(1); expect(await status()).toBe("outstanding");
  await persistEvidenceConfirmation(client, file, async () => {});
  expect(await count()).toBe(1); expect(await status()).toBe("uploaded");
});
test("log or advancement failure retries the same saved file without reinserting", async () => {
  for (const step of ["log", "advance"]) {
    await expect(persistEvidenceConfirmation(client, file, async () => { throw new Error(step); })).rejects.toThrow(step);
    await persistEvidenceConfirmation(client, file, async () => {});
    expect(await count()).toBe(1);
  }
});
test("concurrent confirmations use existing primary key to admit only one evidence row", async () => {
  await Promise.allSettled(Array.from({ length: 4 }, () => persistEvidenceConfirmation(client, file, async () => {})));
  await persistEvidenceConfirmation(client, file, async () => {});
  expect(await count()).toBe(1); expect(await status()).toBe("uploaded");
  expect(await evidencePathId(file.storage_path)).toBe(await evidencePathId(file.storage_path));
  expect(await evidencePathId(`${file.storage_path}-different`)).not.toBe(await evidencePathId(file.storage_path));
});
test("legacy random ID for the path is reused, including after human rejection", async () => {
  await db.query("INSERT INTO evidence_files(id,requirement_id,job_id,storage_path) VALUES ($1,$2,$3,$4)", ["33333333-3333-4333-8333-333333333333", req, job, file.storage_path]);
  await db.exec("UPDATE evidence_requirements SET status='rejected'");
  await persistEvidenceConfirmation(client, file, async () => {});
  expect(await count()).toBe(1); expect(await status()).toBe("rejected");
});
test("read failures and cross-requirement reuse never falsely confirm", async () => {
  failure = "read";
  await expect(persistEvidenceConfirmation(client, file, async () => {})).rejects.toThrow("injected read failure");
  await persistEvidenceConfirmation(client, file, async () => {});
  await expect(persistEvidenceConfirmation(client, { ...file, requirement_id: job }, async () => {})).rejects.toThrow("another evidence requirement");
  expect(await count()).toBe(1);
});
test("confirmation does not claim original capture time or verified evidence", async () => {
  await persistEvidenceConfirmation(client, file, async () => {});
  expect((await db.query<{ captured_at: unknown }>("SELECT captured_at FROM evidence_files")).rows[0]?.captured_at).toBeNull();
  expect(await status()).toBe("uploaded");
});