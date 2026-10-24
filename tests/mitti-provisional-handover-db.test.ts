// Jo 24 Oct (HV-3151/HV-3164): an installer's provisional Add-job size gives way to the job's Mitti Ready Check form.
// Real rows on PGlite with the live one-current index and the permanent-supplied-figures trigger.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid not null, is_current boolean not null default true,
  status text, source_role text, created_by uuid, external_source text, external_id text, provenance text, supplied_area_m2 numeric, accepted_by uuid);
CREATE UNIQUE INDEX ceiling_measurements_one_current ON ceiling_measurements(job_id) WHERE is_current;
CREATE FUNCTION guard_supplied() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.supplied_area_m2 IS DISTINCT FROM OLD.supplied_area_m2 THEN RAISE EXCEPTION 'installer-supplied measurement figures are permanent'; END IF; RETURN NEW; END $$;
CREATE TRIGGER g BEFORE UPDATE ON ceiling_measurements FOR EACH ROW EXECUTE FUNCTION guard_supplied();
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, event_type text, details jsonb);`);
const J = "00000000-0000-0000-0000-000000003164", K = "00000000-0000-0000-0000-000000003165";
await db.exec(`INSERT INTO ceiling_measurements (id, job_id, status, external_source, external_id, provenance, supplied_area_m2)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '${J}', 'needs_review', 'installer_import', 'e882d1d1', 'installer_supplied_provisional', 120),
         ('00000000-0000-0000-0000-0000000000a2', '${K}', 'draft', null, null, null, null);`);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, _a: unknown, type: string, _s: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, event_type, details) values ($1,$2,$3)", [job, type, JSON.stringify(details ?? {})]); },
}));
const { pointMeasurementAtMitti } = await import("../src/lib/mitti.server");
const current = async (job: string) => (await db.query<Record<string, unknown>>("select * from ceiling_measurements where job_id = $1 and is_current", [job])).rows;

describe("pointMeasurementAtMitti", () => {
  test("provisional size is kept as history and the form gets a fresh current record", async () => {
    const [m] = await current(J);
    await pointMeasurementAtMitti(J, m as never, "audit_deep", null);
    const now = await current(J);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ external_source: "mitti", external_id: "audit_deep", provenance: null, supplied_area_m2: null, status: "draft" });
    const old = (await db.query<Record<string, unknown>>("select * from ceiling_measurements where id = '00000000-0000-0000-0000-0000000000a1'")).rows[0];
    expect(old).toMatchObject({ is_current: false, external_source: "installer_import", supplied_area_m2: "120" });
    const ev = (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id = $1", [J])).rows;
    expect(ev.map((e) => e.event_type)).toEqual(["mitti_provisional_superseded"]);
  });
  test("an ordinary open record is adopted in place (unchanged behaviour)", async () => {
    const [m] = await current(K);
    await pointMeasurementAtMitti(K, m as never, "audit_k", null);
    const now = await current(K);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ id: "00000000-0000-0000-0000-0000000000a2", external_source: "mitti", external_id: "audit_k" });
  });
});
