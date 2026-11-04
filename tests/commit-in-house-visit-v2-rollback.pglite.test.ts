// G6 N4 (final Part 9 review, 4 Nov 2026): docs/pending-migrations/2026-11-04_commit_in_house_visit_v2.sql has an undo file
// that puts back the EXACT prior function body (2026-11-01_in_house_saved_work.sql). Proven on a practice Postgres
// (PGlite) with every portal table: the prior file, then v2 (the body changes), then the rollback (the body is the prior
// one again, byte for byte), then v2 again (re-apply works). Never the live database.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { journeyDb } from "./helpers/pglite-journey-db";

const read = (f: string) => readFileSync(`docs/pending-migrations/${f}`, "utf8");
const PRIOR = read("2026-11-01_in_house_saved_work.sql");
const V2 = read("2026-11-04_commit_in_house_visit_v2.sql");
const ROLLBACK = read("2026-11-04_commit_in_house_visit_v2.rollback.sql");
const ALLOCATE_V2 = read("2026-11-03_allocate_team_electrician_v2.sql");
const ELECTRICIAN = read("2026-11-01_in_house_electrician.sql");

const j = await journeyDb();
afterAll(async () => { await j.db.close(); });
const body = async () => (await j.db.query<{ prosrc: string }>("select prosrc from pg_proc where proname = 'commit_in_house_visit'")).rows.map((r) => r.prosrc);
const grants = async () => (await j.db.query<{ acl: string | null }>("select proacl::text acl from pg_proc where proname = 'commit_in_house_visit'")).rows[0]?.acl ?? null;

describe("2026-11-04_commit_in_house_visit_v2.sql ↔ its rollback", () => {
  test("prior → v2 → rollback → v2: the rollback restores the exact prior body and the grants; v2 applies again", async () => {
    await j.db.exec(ELECTRICIAN).catch(() => { /* the electrician helper may already exist in the generated schema */ });
    await j.db.exec(ALLOCATE_V2);
    await j.db.exec(PRIOR);
    const prior = await body();
    expect(prior).toHaveLength(1);
    expect(prior[0]).toContain("w.profile_id IS NULL"); // the check v2 drops
    const priorGrants = await grants();
    await j.db.exec(V2);
    const v2 = await body();
    expect(v2).toHaveLength(1);
    expect(v2[0]).not.toContain("w.profile_id IS NULL");
    expect(v2[0]).toContain("contact_releases"); // J4 G2
    expect(v2[0]).not.toEqual(prior[0]);
    await j.db.exec(ROLLBACK);
    expect(await body()).toEqual(prior);
    expect(await grants()).toEqual(priorGrants);
    await j.db.exec(V2);
    expect(await body()).toEqual(v2);
  });
  test("the rollback file is the prior file's function, verbatim (no drift between the two files)", () => {
    const start = PRIOR.indexOf("CREATE OR REPLACE FUNCTION public.commit_in_house_visit(");
    const endMarker = "GRANT EXECUTE ON FUNCTION public.commit_in_house_visit(uuid,uuid,text,timestamptz,uuid,text,timestamptz,uuid,uuid,jsonb,jsonb,uuid) TO service_role;";
    const end = PRIOR.indexOf(endMarker) + endMarker.length;
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const priorFn = PRIOR.slice(start, end);
    const rb = ROLLBACK.slice(ROLLBACK.indexOf("CREATE OR REPLACE FUNCTION public.commit_in_house_visit("));
    expect(rb.trim()).toBe(priorFn.trim());
  });
});
