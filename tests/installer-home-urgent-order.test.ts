// Installer home: "Action needed" shows the most urgent job first (spec 2026-10-31-installer-action-urgent-first-design).
// Order only: same jobs, same words, other groups keep their order.
import { describe, expect, test } from "bun:test";
import { installerHomeGroups, type InstallerHomeJob } from "../src/lib/installer-home.core";

const job = (o: Partial<InstallerHomeJob>): InstallerHomeJob => ({
  jobId: "j", jobNumber: "HV-3066", street: "5 Somerset Court, Mulgrave", suburb: "Mulgrave", channel: "hivic_sourced", stage: "ready_check_ready_to_schedule",
  place: "needs_me", placeTitle: "Do the Ready Check", nextAction: null, quoteLine: null, status: null, upcoming: null, installDeadline: null, endedAt: null, ...o,
});
const action = (jobs: InstallerHomeJob[]) => installerHomeGroups(jobs).action.map((r) => r.jobId);

describe("Action needed order", () => {
  test("soonest install deadline first", () => {
    expect(action([job({ jobId: "late", installDeadline: "2026-12-01" }), job({ jobId: "soon", installDeadline: "2026-11-05" })])).toEqual(["soon", "late"]);
  });
  test("a deadline beats no deadline", () => {
    expect(action([job({ jobId: "none" }), job({ jobId: "dated", installDeadline: "2027-03-01" })])).toEqual(["dated", "none"]);
  });
  test("no deadline: waited longest (oldest waitedSince) first, null last", () => {
    expect(action([
      job({ jobId: "unknown", waitedSince: null }), job({ jobId: "missing" }),
      job({ jobId: "new", waitedSince: "2026-10-30T00:00:00Z" }), job({ jobId: "old", waitedSince: "2026-10-01T00:00:00Z" }),
    ])).toEqual(["old", "new", "unknown", "missing"]);
  });
  test("same deadline: oldest waitedSince breaks the tie", () => {
    expect(action([
      job({ jobId: "b", installDeadline: "2026-11-05", waitedSince: "2026-10-30T00:00:00Z" }),
      job({ jobId: "a", installDeadline: "2026-11-05", waitedSince: "2026-10-01T00:00:00Z" }),
    ])).toEqual(["a", "b"]);
  });
  test("full tie: lower job number first, numeric-aware", () => {
    expect(action([job({ jobId: "h100", jobNumber: "HV-100" }), job({ jobId: "h99", jobNumber: "HV-99" })])).toEqual(["h99", "h100"]);
    expect(action([job({ jobId: "n100", jobNumber: 100 }), job({ jobId: "n99", jobNumber: 99 }), job({ jobId: "s20", jobNumber: "20" })])).toEqual(["s20", "n99", "n100"]);
  });
  test("input order never matters", () => {
    const a = [job({ jobId: "x", jobNumber: "HV-5" }), job({ jobId: "y", jobNumber: "HV-4", installDeadline: "2026-11-09" }), job({ jobId: "z", jobNumber: "HV-3", waitedSince: "2026-09-01T00:00:00Z" })];
    expect(action(a)).toEqual(["y", "z", "x"]);
    expect(action([...a].reverse())).toEqual(["y", "z", "x"]);
  });
  test("the other groups keep their exact current order", () => {
    const coming = (id: string, n: string) => job({ jobId: id, jobNumber: n, place: "coming_up", upcoming: { what: "Install", start: "2026-11-10T21:00:00Z" }, installDeadline: id === "c1" ? "2026-12-01" : "2026-11-01", waitedSince: id === "c1" ? "2026-10-30T00:00:00Z" : "2026-10-01T00:00:00Z" });
    const progress = (id: string, n: string) => job({ jobId: id, jobNumber: n, place: "moving", stage: "ready_check_scheduled", installDeadline: id === "p1" ? "2026-12-01" : "2026-11-01" });
    const done = (id: string, n: string) => job({ jobId: id, jobNumber: n, stage: "complete", endedAt: "2026-10-10T00:00:00Z", installDeadline: id === "d1" ? "2026-12-01" : "2026-11-01" });
    const g = installerHomeGroups([coming("c1", "HV-100"), coming("c2", "HV-99"), progress("p1", "HV-100"), progress("p2", "HV-99"), done("d1", "HV-100"), done("d2", "HV-99")]);
    expect(g.coming.map((r) => r.jobId)).toEqual(["c1", "c2"]);
    expect(g.progress.map((r) => r.jobId)).toEqual(["p1", "p2"]);
    expect(g.done.map((r) => r.jobId)).toEqual(["d1", "d2"]);
  });
});
