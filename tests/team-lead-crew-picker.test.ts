import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { allocationBlocker, ALLOCATION_REASON } from "../src/lib/visit-allocation.core";
import { crewSelectionProblems, CREW_NOT_LEAD_MESSAGE } from "../src/lib/piisa-a3.core";
const src = (p: string) => readFileSync(p, "utf8");
const today = "2026-10-29";
const cleared = { workerId: "a", name: "Ann", tradeRole: "installer", email: null, mobile: "0412345678",
  clearance: { certStatus: "verified", level: "full", expiresOn: "2027-12-31" } };

describe("crew is never the install Lead", () => {
  test("allocation", () => {
    expect(ALLOCATION_REASON.crew).toBe("Crew can't be the install-day Lead — pick a Lead.");
    expect(allocationBlocker("install", { ...cleared, workerRole: "crew" }, today)).toBe(ALLOCATION_REASON.crew);
    expect(allocationBlocker("install", { ...cleared, workerRole: "lead" }, today)).toBeNull();
    expect(allocationBlocker("install", { ...cleared, workerRole: null }, today)).toBeNull();
  });
  test("picker", () => {
    const s = (id: string, name: string, workerRole: "lead" | "crew") => ({ workerId: id, name, eec: `CII-${id}`, eecVerified: true, workerRole });
    const staff = [s("a", "Ann Crew", "crew"), s("b", "Bob Lead", "lead")];
    expect(crewSelectionProblems({ lead: "a", additional: [] }, staff).problems).toEqual([`Ann Crew ${CREW_NOT_LEAD_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "b", additional: [{ workerId: "a" }] }, staff).problems).toEqual([]);
  });
});
describe("ready check needs a Mitti login, not Lead", () => {
  test("crew and uncleared people pass the pure check; the server gate is the Mitti login", () => {
    expect(allocationBlocker("ready_check", { ...cleared, workerRole: "crew" }, today)).toBeNull();
    expect(allocationBlocker("ready_check", { ...cleared, clearance: null }, today)).toBeNull();
    const srv = src("src/lib/visit-allocation.server.ts");
    const fn = srv.slice(srv.indexOf("export async function allocateVisit"));
    expect(fn).toContain("mittiEmailFor(");
    expect(fn.indexOf("addInMittiFirst(")).toBeLessThan(fn.indexOf("VISIT_ALLOCATED_EVENT"));
    expect(src("src/lib/piisa-a3.server.ts")).toContain("worker_role");
  });
});
