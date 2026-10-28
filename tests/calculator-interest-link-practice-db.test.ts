import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL = readFileSync(new URL("../docs/pending-migrations/calculator-interest-enquiry-link.sql", import.meta.url), "utf8");

test("calculator registrations can link to an enquiry; old rows stay unlinked; reruns are safe", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.calculator_interests (id uuid primary key default gen_random_uuid(), email text not null);
    INSERT INTO public.calculator_interests(email) VALUES ('old@hivic-test.example');
  `);
  await db.exec(SQL);
  await db.exec(SQL);
  const old = await db.query<{ job_id: string | null }>("select job_id from public.calculator_interests");
  expect(old.rows[0]!.job_id).toBeNull();
  const job = await db.query<{ id: string }>("insert into public.jobs default values returning id");
  await db.query("update public.calculator_interests set job_id = $1", [job.rows[0]!.id]);
  await db.query("delete from public.jobs");
  expect((await db.query<{ job_id: string | null }>("select job_id from public.calculator_interests")).rows[0]!.job_id).toBeNull();
});
