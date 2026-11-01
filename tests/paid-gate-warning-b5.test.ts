import { expect, test } from "bun:test";
import { buildNeedsRows, type NeedsFacts } from "../src/lib/office-needs.core";
import { nextAction } from "../src/lib/job-next-action.core";
import { paidGateWarnings } from "../src/lib/paid-gate-warning.server";
const NOW = Date.parse("2026-11-01T09:22:00Z");
const blockers = ["Owner paperwork B: The agreement not signed yet.", "Owner paperwork B: Payment not signed yet."];
const facts = (paid = true, reasons = blockers): NeedsFacts => ({ jobId: "fixture", jobNumber: "HV-FIXTURE", surname: "Fixture", suburb: "Richmond",
  ...({ paidGate: { paid, at: "2026-11-01T06:34:00Z", blockers: reasons } }),
});
const rows = (f: NeedsFacts) => Object.values(buildNeedsRows({ now: NOW, jobs: [f] })).flat();
const next = (f: NeedsFacts) => nextAction({ facts: f, status: { label: "PIESA next", waitingOn: "System", detail: null, dueAt: null }, stage: "quote", closed: null, onHold: null }, NOW);
test("$349 cleared but paperwork blocked gives one Needs me row naming the actual items", () => {
  const r = rows(facts()); expect(r).toHaveLength(1);
  expect(r[0]?.line).toBe("Paid, waiting on owner paperwork: The agreement not signed yet.; Payment not signed yet.");
  expect(r[0]?.button.label).toBe("Open job");
});
test("office Next shows the identical paid blocker instead of nothing for the office", () => {
  expect(next(facts()).sentence).toBe("Paid, waiting on owner paperwork: The agreement not signed yet.; Payment not signed yet.");
});
test("clearing the gate removes its derived row and Next warning", () => {
  expect(rows(facts())).toHaveLength(1); expect(rows(facts(true, []))).toHaveLength(0);
  expect(next(facts(true, [])).sentence).not.toContain("Paid, waiting");
});
test("unpaid jobs never get the paid-blocker row", () => {
  expect(rows(facts(false))).toHaveLength(0); expect(next(facts(false)).sentence).not.toContain("Paid, waiting");
});
test("shared reader rechecks clearing gates, excludes unpaid and ended jobs, and never calls a writer", async () => {
  let reasons = blockers; const calls: string[] = [];
  const jobs = [{ id: "paid", stage: "measured_quote_accepted", at: "2026-11-01T06:34:00Z" }, { id: "unpaid", stage: "measured_quote_accepted", at: "2026-11-01T06:34:00Z" }, { id: "ended", stage: "complete", at: "2026-11-01T06:34:00Z" }];
  const readers = { paid: async (id: string) => id === "paid", blockers: async (id: string) => { calls.push(id); return reasons; } };
  expect([...(await paidGateWarnings(jobs, readers)).keys()]).toEqual(["paid"]);
  reasons = []; expect((await paidGateWarnings(jobs, readers)).size).toBe(0);
  expect(calls).toEqual(["paid", "paid"]);
  await expect(paidGateWarnings(jobs, { ...readers, blockers: async () => { throw Error("Unreadable gate"); } })).rejects.toThrow("Unreadable gate");
});