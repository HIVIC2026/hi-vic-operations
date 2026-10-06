// Practice database (PGlite) proof for review H / 0128. Fake data only.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
test("hourly limit is enforced inside the database; undo removes the function", async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE owner_link_codes (id uuid primary key default gen_random_uuid(), job_id uuid, channel text, destination_masked text, code_hash text, expires_at timestamptz, created_at timestamptz default now());`);
  await db.exec(read("0128_owner_code_request_atomic.sql"));
  const J = "11111111-1111-1111-1111-111111111111";
  const call = () => db.query<{ id: string | null }>(`SELECT public.issue_owner_link_code('${J}','sms','04** *** 901','h', now() + interval '10 min', 3) AS id`);
  const ids = []; for (let i = 0; i < 5; i++) ids.push((await call()).rows[0]!.id);
  expect(ids.filter(Boolean).length).toBe(3);
  expect(ids.slice(3)).toEqual([null, null]);
  await db.exec(read("0128_owner_code_request_atomic.rollback.sql"));
  const left = await db.query(`SELECT 1 FROM pg_proc WHERE proname='issue_owner_link_code'`);
  expect(left.rows.length).toBe(0);
});
