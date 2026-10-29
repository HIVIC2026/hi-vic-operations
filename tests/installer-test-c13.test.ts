// Jo 29 Oct 2026: C13 (Ready Check booking for not-quoted jobs) rebuilt on the Add a job path, TEST data only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("installer-test C13 makes its jobs through Add a job and checks booking + no other trade", () => {
  const s = readFileSync("scripts/installer-test.ts", "utf8");
  const c13 = s.slice(s.indexOf('await step(steps, "C13"'), s.indexOf('await step(steps, "C15"'));
  expect(c13.length).toBeGreaterThan(100);
  expect(c13).toContain("pi.createImportFor(ownerId, { businessId: BIZ");
  expect(c13).toContain('installer: { quoted: "no", site_check: "no"');
  expect(c13).toContain("madeJobs.push(r.jobId);");
  expect(c13).toContain("rc.installerRcState(j1)");
  expect(c13).toContain("rc.bookOwnReadyCheck(j1, ownerId");
  expect(c13).toContain("never offered to any other trade");
  expect(c13).toContain("@hivic-test.example");
  expect(c13).not.toMatch(/bulk-import|bulk_import|confirmBatch/);
  expect(s).toContain('import { readyCheckBookingOutcome } from "./portal-qa-coverage";');
});

test("trade-shots lists /field/business/team once (business-team only)", () => {
  const s = readFileSync("scripts/trade-shots.ts", "utf8");
  expect(s).toContain('["business-team", "/field/business/team"]');
  expect(s).not.toContain("staff-and-invites");
  expect(s.match(/"\/field\/business\/team"/g)?.length).toBe(1);
});
