// Practice database (PGlite) proof for 0115: linked staff + business boss get job access; others don't; rollback clean.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const UP = readFileSync("docs/pending-migrations/0115_trade_job_access.sql", "utf8");
const DOWN = readFileSync("docs/pending-migrations/0115_trade_job_access.rollback.sql", "utf8");
const ID = { job: "00000000-0000-4000-8000-000000000001", other: "00000000-0000-4000-8000-000000000002", biz: "00000000-0000-4000-8000-000000000003", boss: "00000000-0000-4000-8000-000000000004", worker: "00000000-0000-4000-8000-000000000005", stranger: "00000000-0000-4000-8000-000000000006", pw: "00000000-0000-4000-8000-000000000007", otherBiz: "00000000-0000-4000-8000-000000000008" };

async function db() {
  const d = new PGlite();
  await d.exec(`
    CREATE TYPE public.assignment_role AS ENUM ('electrician','installer','property_manager');
    CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, business_id uuid, role public.assignment_role, active boolean default true);
    CREATE TABLE public.partner_workers (id uuid primary key, profile_id uuid, trade_role public.assignment_role, approval_status text, removed_at timestamptz);
    CREATE TABLE public.worker_job_links (job_id uuid, worker_id uuid, business_id uuid, revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean default true);
    INSERT INTO public.job_assignments VALUES ('${ID.job}','${ID.boss}','${ID.biz}','installer',true), ('${ID.other}','${ID.stranger}','${ID.otherBiz}','installer',true);
    INSERT INTO public.partner_workers VALUES ('${ID.pw}','${ID.worker}','installer','approved',null);
    INSERT INTO public.worker_job_links VALUES ('${ID.job}','${ID.pw}','${ID.biz}',null, now() + interval '30 days');
    INSERT INTO public.business_members VALUES ('${ID.biz}','${ID.boss}','business_admin',true), ('${ID.biz}','${ID.worker}','member',true);
  `);
  await d.exec(DOWN);
  return d;
}
const role = async (d: PGlite, job: string, user: string) => ((await d.query<{ r: string | null }>(`select public.job_assignment_role('${job}','${user}')::text as r`)).rows[0]?.r ?? null);

describe("0115 trade job access (practice database)", () => {
  test("before: linked worker has no access", async () => {
    const d = await db();
    expect(await role(d, ID.job, ID.worker)).toBeNull();
  });
  test("after: linked worker and boss get access; strangers and other jobs don't", async () => {
    const d = await db(); await d.exec(UP);
    expect(await role(d, ID.job, ID.worker)).toBe("installer");
    expect(await role(d, ID.job, ID.boss)).toBe("installer");
    expect(await role(d, ID.job, ID.stranger)).toBeNull();
    expect(await role(d, ID.other, ID.worker)).toBeNull();
    expect(await role(d, ID.other, ID.boss)).toBeNull();
  });
  test("revoked link or removed worker loses access", async () => {
    const d = await db(); await d.exec(UP);
    await d.exec(`update public.worker_job_links set revoked_at = now()`);
    expect(await role(d, ID.job, ID.worker)).toBeNull();
    await d.exec(`update public.worker_job_links set revoked_at = null; update public.partner_workers set removed_at = now()`);
    expect(await role(d, ID.job, ID.worker)).toBeNull();
  });
  test("rollback restores the old rule", async () => {
    const d = await db(); await d.exec(UP); await d.exec(DOWN);
    expect(await role(d, ID.job, ID.worker)).toBeNull();
    expect(await role(d, ID.job, ID.boss)).toBe("installer");
  });
});
