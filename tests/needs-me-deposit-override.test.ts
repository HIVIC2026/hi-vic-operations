import { expect, test } from "bun:test";
import { depositClearedJobs } from "../src/lib/deposit-cleared.core";
import { buildNeedsRows, type NeedsFacts } from "../src/lib/office-needs.core";
import { officeStatus } from "../src/lib/office-status.core";

// Jo 1 Nov 2026 (HV-3666): an admin override of the $349 block must put the job in Needs me as
// "Choose electrician", the same as a paid job, instead of leaving it as "waiting for the owner's payment".

const NOW = Date.parse("2026-11-01T00:00:00Z");

test("override on the installation invoice counts as cleared and is marked overridden", () => {
  const r = depositClearedJobs(
    [
      { id: "inv-paid", job_id: "job-paid", deposit_cleared: true },
      { id: "inv-ov", job_id: "job-ov", deposit_cleared: false },
      { id: "inv-unpaid", job_id: "job-unpaid", deposit_cleared: false },
    ],
    [{ invoice_id: "inv-ov", job_id: "job-ov" }],
  );
  expect([...r.paid].sort()).toEqual(["job-ov", "job-paid"]);
  expect([...r.overridden]).toEqual(["job-ov"]);
});

test("an override on a different invoice (not the installation one) clears nothing", () => {
  const r = depositClearedJobs(
    [{ id: "inv-install", job_id: "job-a", deposit_cleared: false }],
    [{ invoice_id: "inv-other", job_id: "job-a" }],
  );
  expect(r.paid.size).toBe(0);
  expect(r.overridden.size).toBe(0);
});

test("paid and overridden: shown as paid, not overridden", () => {
  const r = depositClearedJobs(
    [{ id: "inv", job_id: "job", deposit_cleared: true }],
    [{ invoice_id: "inv", job_id: "job" }],
  );
  expect([...r.paid]).toEqual(["job"]);
  expect(r.overridden.size).toBe(0);
});

test("overridden job reads 'PIESA to book', not waiting on the owner", () => {
  const facts = { id: "j", stage: "measured_quote_accepted", createdAt: "2026-10-31T00:00:00Z", enteredStageAt: "2026-10-31T12:53:00Z", paymentCleared: true } as Parameters<typeof officeStatus>[0];
  expect(officeStatus(facts, NOW, {})?.key).toBe("quote.paid");
});

test("Needs me line says overridden when the $349 was overridden", () => {
  const job = (id: string, extra: Partial<NeedsFacts>): NeedsFacts => ({ jobId: id, jobNumber: `HV-${id}`, surname: "Smith", suburb: "Croydon", ...extra });
  const rows = buildNeedsRows({ now: NOW, jobs: [
    job("3666", { electricianToChoose: { at: "2026-10-31T23:27:00Z", usual: null, overridden: true } }),
    job("3667", { electricianToChoose: { at: "2026-10-31T23:27:00Z", usual: null } }),
  ] });
  const all = [...rows.today, ...rows.week, ...rows.watch];
  const ov = all.find((r) => r.jobNumber === "HV-3666")!;
  const paid = all.find((r) => r.jobNumber === "HV-3667")!;
  expect(ov.kind).toBe("choose_electrician");
  expect(ov.line).toContain("$349 overridden");
  expect(ov.line).not.toContain("$349 paid");
  expect(paid.line).toContain("$349 paid");
});
