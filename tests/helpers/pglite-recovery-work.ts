// Throwaway in-process PostgreSQL (PGlite) for the recovery_work list. Fake TEST data only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) =>
  readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const RECOVERY_SQL = read("recovery-work.sql");
export const RECOVERY_ROLLBACK_SQL = read("recovery-work.rollback.sql");

export const RW_JOB = "10000000-0000-4000-8000-0000000000c1";

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid primary key, job_number text);
GRANT SELECT ON public.jobs TO authenticated, service_role;
`;

export async function recoveryDb(applySql = true) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`INSERT INTO public.jobs VALUES ('${RW_JOB}', 'TEST-0001');`);
  if (applySql) await db.exec(RECOVERY_SQL);
  return db;
}

export async function asRole<T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
