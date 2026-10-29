// Jo 29 Oct 2026: C13 (Ready Check booking for not-quoted jobs) rebuilt on the Add a job path, TEST data only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("installer-test C13 makes its jobs through the live Add a job path and checks booking + no other trade", () => {
  const s = readFileSync("scripts/installer-test.ts", "utf8");
  const c13 = s.slice(s.indexOf('await step(steps, "C13"'), s.indexOf('await step(steps, "C15"'));
  expect(c13.length).toBeGreaterThan(100);
  // Jo 29 Oct re-review: same call as the Add a job screen (add-job-flow -> startOnsiteReadyCheck), offline Mitti stub like C15.
  expect(c13).toContain("os.startOnsiteReadyCheckFor(ownerId, BIZ, {");
  expect(c13).toContain('throw new Error("Mitti could not be reached. Try again shortly.");');
  expect(c13).toContain('{ mode: "hivic" }, offline, { leadOrigin: "owner_contacted" }');
  expect(c13).not.toMatch(/createImportFor|confirmImportFor/);
  expect(c13).toContain("madeJobs.push(r.jobId);");
  expect(c13).toContain("rc.installerRcState(j1)");
  expect(c13).toContain("rc.bookOwnReadyCheck(j1, ownerId");
  expect(c13).toContain("@hivic-test.example");
  expect(c13).not.toMatch(/bulk-import|bulk_import|confirmBatch/);
  // The "never offered" and "nothing sent" checks run before the booking outcome, so its NOT_RUN can't hide them.
  const outcome = c13.indexOf("readyCheckBookingOutcome(");
  expect(outcome).toBeGreaterThan(0);
  for (const check of ["never offered to any other trade", "I'll book it: nothing sent to the owner", "nothing sent to the second owner either"]) {
    expect(c13.indexOf(check)).toBeGreaterThan(0);
    expect(c13.indexOf(check)).toBeLessThan(outcome);
  }
  expect(s).toContain('import { readyCheckBookingOutcome } from "./portal-qa-coverage";');
});

test("trade-shots lists /field/business/team once (business-team only)", () => {
  const s = readFileSync("scripts/trade-shots.ts", "utf8");
  expect(s).toContain('["business-team", "/field/business/team"]');
  expect(s).not.toContain("staff-and-invites");
  expect(s.match(/"\/field\/business\/team"/g)?.length).toBe(1);
});
