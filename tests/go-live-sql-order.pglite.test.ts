// G6 go-live (4 Nov 2026): the pending SQL files in docs/GO-LIVE-RUNBOOK-2026-11-04.md apply IN THAT ORDER on a practice
// Postgres (PGlite) with every portal table — one test, one database, the files verbatim. Also: every file has its undo
// file beside it (named in the runbook), the undo files apply in reverse, and the optional credential-amount file applies
// last. Never the live database. The live shape of businesses.piesa_booked_by (already there from main) is simulated first.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { journeyDb } from "./helpers/pglite-journey-db";

/** The runbook's order, with each file's undo. */
export const GO_LIVE_SQL: { file: string; undo: string }[] = [
  { file: "installer-portal-roles.sql", undo: "installer-portal-roles.rollback.sql" },
  { file: "installer-worker-identity-dob.sql", undo: "installer-worker-identity-dob.rollback.sql" },
  { file: "installer-business-settings.sql", undo: "installer-business-settings.rollback.sql" },
  { file: "2026-11-01_in_house_electrician.sql", undo: "2026-11-01_in_house_electrician.undo.sql" },
  { file: "2026-11-03_allocate_team_electrician_v2.sql", undo: "2026-11-03_allocate_team_electrician_v2_rollback.sql" },
  { file: "2026-11-01_in_house_saved_work.sql", undo: "2026-11-01_in_house_saved_work.undo.sql" },
  { file: "2026-11-04_commit_in_house_visit_v2.sql", undo: "2026-11-04_commit_in_house_visit_v2.rollback.sql" },
  { file: "2026-11-03_electrician_job_links.sql", undo: "2026-11-03_electrician_job_links.undo.sql" },
  { file: "2026-11-03_installer_added_electricians.sql", undo: "2026-11-03_installer_added_electricians.undo.sql" },
  { file: "customer-agreement-v1-3.sql", undo: "customer-agreement-v1-3.rollback.sql" },
  { file: "add-installer-job-atomic.sql", undo: "add-installer-job-atomic.undo.sql" },
];
export const GO_LIVE_SQL_OPTIONAL = { file: "2026-11-02-credential-amount-insured.sql", undo: "2026-11-02-credential-amount-insured.rollback.sql" };
const read = (f: string) => readFileSync(`docs/pending-migrations/${f}`, "utf8");
/** The journey schema types enums as text domains, so `ALTER TYPE … ADD VALUE` can't run on it; those statements are
 *  proven on real enums by tests/installer-worker-identity-dob.pglite.test.ts and are skipped here (counted below). */
const forPractice = (sql: string) => sql.replace(/^\s*ALTER TYPE public\.[a-z_]+ ADD VALUE IF NOT EXISTS '[a-z_]+';\s*$/gm, "-- (enum value added on live; text domain here)");

const j = await journeyDb();
afterAll(async () => { await j.db.close(); });
const fn = async (name: string) => (await j.db.query("select 1 from pg_proc where proname = $1", [name])).rows.length;
const col = async (table: string, column: string) => (await j.db.query("select 1 from information_schema.columns where table_name = $1 and column_name = $2", [table, column])).rows.length;

describe("go-live pending SQL, in the runbook's order", () => {
  test("every file and its undo exist; the runbook names them in this order", () => {
    for (const s of [...GO_LIVE_SQL, GO_LIVE_SQL_OPTIONAL]) {
      expect(existsSync(`docs/pending-migrations/${s.file}`), s.file).toBe(true);
      expect(existsSync(`docs/pending-migrations/${s.undo}`), s.undo).toBe(true);
    }
    const runbook = readFileSync("docs/GO-LIVE-RUNBOOK-2026-11-04.md", "utf8");
    let at = 0;
    for (const s of GO_LIVE_SQL) { const i = runbook.indexOf(s.file, at); expect(i, `${s.file} in order in the runbook`).toBeGreaterThan(at - 1); at = i; expect(runbook, s.undo).toContain(s.undo); }
    expect(runbook).toContain(GO_LIVE_SQL_OPTIONAL.file);
    expect(runbook.indexOf(GO_LIVE_SQL_OPTIONAL.file)).toBeGreaterThan(at);
  });
  test("the files apply in order on one database (live shape: piesa_booked_by already present), then the optional one; the undo files apply in reverse", async () => {
    // The live database already has main's column (2026-11-03_piesa_booked_by.sql applied) — the generated schema has it too
    // (types.ts); the file must apply over it. The journey schema has no auth.users rows / drizzle functions the files need
    // beyond what the generated tables give; a file that needs a drizzle-era helper is listed in `needs` and loaded first.
    expect(await col("businesses", "piesa_booked_by")).toBe(1);
    const { loadPendingFunctions } = await import("./helpers/journey-harness");
    // Already live (drizzle chain 0181 / generated types): the quick-taps batch function that 2026-11-01_in_house_electrician.sql
    // rewrites in place. The runbook's step 0 checks it exists live before anything is applied.
    const pre = await loadPendingFunctions(j, ["commit_guarded_stage", "has_role", "is_business_member", "can_access_job", "allocate_in_house_batch_job"]);
    expect(pre.loaded).toContain("allocate_in_house_batch_job");
    const applied: string[] = [];
    for (const s of GO_LIVE_SQL) {
      try { await j.db.exec(forPractice(read(s.file))); applied.push(s.file); }
      catch (e) { throw new Error(`${s.file} failed after [${applied.join(", ")}]: ${(e as Error).message}`); }
    }
    expect(applied).toEqual(GO_LIVE_SQL.map((s) => s.file));
    // What the files leave behind (spot checks, one per file group).
    expect(await col("partner_workers", "licence_verified_at")).toBe(1);
    expect(await fn("allocate_team_electrician")).toBe(1);
    expect(await fn("commit_in_house_visit")).toBe(1);
    expect((await j.db.query<{ prosrc: string }>("select prosrc from pg_proc where proname = 'commit_in_house_visit'")).rows[0]!.prosrc).toContain("contact_releases"); // v2 won
    expect(await fn("guard_piesa_booked_by")).toBe(1);
    expect(await col("businesses", "workcover_exempt_declared_at")).toBe(1);
    expect(await col("business_credentials", "amount_insured_aud")).toBe(1); // the journey schema carries it for the tests; the optional file adds it live
    await j.db.exec(read(GO_LIVE_SQL_OPTIONAL.file));
    await j.db.exec(read(GO_LIVE_SQL_OPTIONAL.file)); // idempotent
    // Live has drizzle 0014's compliance_templates_guard trigger (the customer-agreement undo disables it inside its
    // transaction); the generated schema has no triggers, so the live one is stood in for here.
    await j.db.exec("CREATE OR REPLACE FUNCTION public.guard_compliance_template() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN COALESCE(NEW, OLD); END $$; DROP TRIGGER IF EXISTS compliance_templates_guard ON public.compliance_templates; CREATE TRIGGER compliance_templates_guard BEFORE UPDATE OR DELETE ON public.compliance_templates FOR EACH ROW EXECUTE FUNCTION public.guard_compliance_template();");
    // Undo in reverse (the optional one first), each file on its own.
    await j.db.exec(read(GO_LIVE_SQL_OPTIONAL.undo));
    for (const s of [...GO_LIVE_SQL].reverse()) {
      try { await j.db.exec(read(s.undo)); }
      catch (e) { throw new Error(`${s.undo} failed: ${(e as Error).message}`); }
    }
    expect(await fn("commit_in_house_visit")).toBe(0);
    expect(await fn("allocate_team_electrician")).toBe(0);
    expect(await fn("guard_piesa_booked_by")).toBe(0);
    expect(await col("businesses", "piesa_booked_by")).toBe(1); // main's live column is never dropped by our undo
    expect(await col("partner_workers", "licence_verified_at")).toBe(0);
    // And forward again (a redo after an undo works).
    for (const s of GO_LIVE_SQL) await j.db.exec(forPractice(read(s.file)));
    expect(await fn("commit_in_house_visit")).toBe(1);
    expect(GO_LIVE_SQL.filter((s) => /ALTER TYPE public\.[a-z_]+ ADD VALUE/.test(read(s.file))).map((s) => s.file)).toEqual(["installer-portal-roles.sql"]); // the only enum change, proven elsewhere
  });
});
