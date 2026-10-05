import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const sql = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");

describe("TEST Centre database guard", () => {
  test("archives only qa_test jobs and rolls back cleanly", async () => {
    const db = new PGlite();
    await db.exec("CREATE SCHEMA public; CREATE TABLE public.jobs (id uuid PRIMARY KEY, source text NOT NULL, qa_archived_at timestamptz);");
    await db.exec("ALTER TABLE public.jobs DROP COLUMN qa_archived_at;");
    await db.exec(sql("0113_qa_test_harness.sql"));
    await db.exec("INSERT INTO public.jobs(id,source) VALUES ('00000000-0000-0000-0000-000000000001','qa_test'),('00000000-0000-0000-0000-000000000002','base44');");
    await db.exec("UPDATE public.jobs SET qa_archived_at=now() WHERE source='qa_test';");
    await expect(db.exec("UPDATE public.jobs SET qa_archived_at=now() WHERE source='base44';")).rejects.toThrow("Only qa_test jobs");
    await db.exec(sql("0113_qa_test_harness.rollback.sql"));
    const columns = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='jobs' AND column_name='qa_archived_at'");
    expect(columns.rows).toHaveLength(0);
    await db.close();
  });
});