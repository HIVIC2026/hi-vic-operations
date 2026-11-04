// Fix wave J4 G2 (join ruling, 4 Nov 2026): booking the PIESA (assessment) or the upgrades (rectification) visit for a
// Team electrician records the owner-contact release for that assignment + visit — the TS fallback writer
// (in-house-inline-save.server `releaseElectricianContact`) writes the identical row the atomic SQL
// (docs/pending-migrations/2026-11-04_commit_in_house_visit_v2.sql) writes; the SQL path is proven by
// tests/journey-a1-complete-route-db.test.ts step 5. Idempotent on (assignment_id, visit_kind).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { OWNER_CONTACT_NOTICE, TRADE_CONTACT_NOTICE } from "../src/lib/allocation.core";

const T: Tables = {};
// memory-postgrest has no upsert: contact_releases gets the one it needs (insert, ignore a duplicate (assignment_id, visit_kind)).
const base = memoryPostgrest(T);
const admin = { from: (t: string) => t === "contact_releases" ? { ...base.from(t), upsert: async (row: Record<string, unknown>, o: { onConflict: string; ignoreDuplicates: boolean }) => {
  const keys = o.onConflict.split(",");
  if (!(T[t] ?? []).some((r) => keys.every((k) => r[k] === row[k]))) (T[t] ??= []).push(row);
  return { data: null, error: null };
} } : base.from(t) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
const { releaseElectricianContact } = await import("../src/lib/in-house-inline-save.server");
const J = "job-1", A = "asg-elec";

describe("J4 G2: the booked electrician visit releases the owner's contact to that assignment", () => {
  beforeEach(() => { for (const k of Object.keys(T)) delete T[k]; T["job_assignments"] = [{ id: "asg-inst", job_id: J, role: "installer", active: true }, { id: A, job_id: J, role: "electrician", active: true }, { id: "asg-old", job_id: J, role: "electrician", active: false }]; T["contact_releases"] = []; });
  test("PIESA booked → one 'piesa' release for the ACTIVE electrician assignment, with the audited notices; booking again adds nothing", async () => {
    await releaseElectricianContact(J, "assessment", "actor-1");
    await releaseElectricianContact(J, "assessment", "actor-1");
    expect(T["contact_releases"]).toEqual([{ job_id: J, assignment_id: A, visit_kind: "piesa", released_by: "actor-1", owner_notice: OWNER_CONTACT_NOTICE, trade_notice: TRADE_CONTACT_NOTICE }]);
  });
  test("upgrades day booked → a 'rectification' release beside the 'piesa' one", async () => {
    await releaseElectricianContact(J, "assessment", null);
    await releaseElectricianContact(J, "rectification", null);
    expect(T["contact_releases"]!.map((r) => r["visit_kind"])).toEqual(["piesa", "rectification"]);
  });
  test("no active electrician on the job → nothing written (the Ready Check / install bookings never call this)", async () => {
    T["job_assignments"] = [{ id: "asg-inst", job_id: J, role: "installer", active: true }];
    await releaseElectricianContact(J, "assessment", null);
    expect(T["contact_releases"]).toEqual([]);
  });
  test("the atomic SQL writes the same row (notices verbatim, same conflict key) and the fallback calls it on both electrician visits", () => {
    const sql = readFileSync("docs/pending-migrations/2026-11-04_commit_in_house_visit_v2.sql", "utf8");
    expect(sql).toContain("IF _kind IN ('assessment','rectification') THEN\n   INSERT INTO public.contact_releases(job_id,assignment_id,visit_kind,released_by,owner_notice,trade_notice)");
    expect(sql).toContain(`'${OWNER_CONTACT_NOTICE}'`);
    expect(sql).toContain(`'${TRADE_CONTACT_NOTICE}'`);
    expect(sql).toContain("ON CONFLICT (assignment_id,visit_kind) DO NOTHING");
    const ts = readFileSync("src/lib/in-house-inline-save.server.ts", "utf8");
    expect(ts).toContain("if(input.kind==='assessment'||input.kind==='rectification')await releaseElectricianContact(jobId,input.kind,actorId);");
  });
});
