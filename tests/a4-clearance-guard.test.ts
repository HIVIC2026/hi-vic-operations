// STEP 73 (W4, A4): a regulated electrical result (assessment completion / PIESA pass-fail) is recorded only by Office or a
// licensed electrician — never by a partner business admin who reaches the job through its business (0115 branch), and
// never by an FFS / installer / owner. Plus the A3 hardening of switchJobElectricianToHivic (access before job state).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLEARANCE_RECORDER_REFUSED, clearanceRecorderAllowed } from "../src/lib/clearance-guard.core";

describe("clearanceRecorderAllowed", () => {
  test("Office (admin) keeps its existing access", () => expect(clearanceRecorderAllowed({ jobRole: "admin", hasElectricianRole: false })).toBe(true));
  test("the licensed electrician assigned to the job may record it", () => expect(clearanceRecorderAllowed({ jobRole: "electrician", hasElectricianRole: true })).toBe(true));
  test("a business admin reaching the job as 'electrician' WITHOUT the electrician role may not", () => expect(clearanceRecorderAllowed({ jobRole: "electrician", hasElectricianRole: false })).toBe(false));
  test("installer / FFS / owner / no relationship may not, even with an electrician role elsewhere", () => {
    for (const jobRole of ["installer", "owner", "property_manager", null]) {
      expect(clearanceRecorderAllowed({ jobRole, hasElectricianRole: true })).toBe(false);
      expect(clearanceRecorderAllowed({ jobRole, hasElectricianRole: false })).toBe(false);
    }
  });
});

function block(src: string, name: string) {
  const i = src.indexOf(`export const ${name} = `);
  return src.slice(i, src.indexOf("export const", i + 10));
}
describe("server functions enforce it", () => {
  const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
  for (const fn of ["completeAssessment", "recordPiesa"]) test(`${fn}: requireJobRole then requireClearanceRecorder, before any read or write`, () => {
    const b = block(portal, fn);
    const role = b.indexOf('const jobRole = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);');
    const guard = b.indexOf("await requireClearanceRecorder(context.supabase as never, jobRole, context.userId);");
    expect(role).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(role);
    expect(b.slice(0, guard)).not.toMatch(/admin\.from\(|transition\(|logEvent\(/);
  });
  test("the guard asks the caller's own client for the electrician role and fails closed on an rpc error", () => {
    const g = portal.slice(portal.indexOf("async function requireClearanceRecorder"), portal.indexOf("async function requireClearanceRecorder") + 900);
    expect(g).toContain('r.rpc("has_role", { _user_id: userId, _role: "electrician" })');
    expect(g).toContain("if (error || !clearanceRecorderAllowed({ jobRole, hasElectricianRole: data === true })) throw new WorkflowError(CLEARANCE_RECORDER_REFUSED);");
    expect(CLEARANCE_RECORDER_REFUSED).toBe("Only a licensed electrician can record this electrical result.");
  });
  test("the PIESA offer acceptance already required the electrician role (same rule, unchanged)", () => {
    expect(readFileSync("src/lib/allocation.server.ts", "utf8")).toContain('admin.rpc("has_role", { _user_id: userId, _role: "electrician" })');
  });
});

describe("A3: switchJobElectricianToHivic checks job access before reading job state", () => {
  test("requireJobRole(['installer']) runs before switchJobToHivic", () => {
    const b = block(readFileSync("src/lib/job-electrician.functions.ts", "utf8"), "switchJobElectricianToHivic");
    const role = b.indexOf('await requireJobRole(context.supabase, data.jobId, ["installer"]);');
    expect(role).toBeGreaterThan(0);
    expect(b.indexOf("switchJobToHivic(data.jobId, context.userId)")).toBeGreaterThan(role);
  });
});
