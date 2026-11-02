import { expect, test } from "bun:test";
import { buildNeedsRows, needsCandidates, type NeedsFacts } from "../src/lib/office-needs.core";

const job = (extra = {}): NeedsFacts => ({ jobId: "one", jobNumber: "HV-1", surname: "Smith", suburb: "Richmond", inHouse: {
  partnerName: "Rapid Insulation", batchSentAt: "2026-10-30T06:00:00Z", readyCheckBooked: false,
  quoteAcceptedAt: null, piesaCompleted: false, installationBooked: false, daysRemaining: null, deadline: null, piesaBooked: false, depositPaid: null,
  ...extra,
} });
const rows = (f: NeedsFacts, at: string) => needsCandidates(f, Date.parse(at)).filter(r => r.kind.startsWith("in_house_"));
const lines = (f: NeedsFacts, at: string) => rows(f, at).map(r => [r.kind, r.line]);
test("Ready Check: not flagged Mon 9 Nov, flagged Tue 10 Nov (Cup Day skipped)", () => {
  expect(rows(job(), "2026-11-09T12:00:00Z")).toHaveLength(0);
  expect(lines(job(), "2026-11-09T13:30:00Z")).toEqual([["in_house_ready_check_not_booked", "Ready Check not booked after 5 business days"]]);
  expect(rows(job({ readyCheckBooked: true }), "2026-11-09T13:30:00Z")).toHaveLength(0);
});
test("PIESA: 10 business days after acceptance", () => {
  const f = job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-30T06:00:00Z", piesaUnlockedAt: "2026-10-30T06:00:00Z" });
  expect(rows(f, "2026-11-16T12:00:00Z")).toHaveLength(0);
  expect(lines(f, "2026-11-16T13:30:00Z")).toEqual([["in_house_piesa_overdue", "PIESA not booked 10 business days after quote accepted"]]);
  expect(rows(job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-30T06:00:00Z", piesaUnlockedAt: "2026-10-30T06:00:00Z", piesaBooked: true }), "2026-11-16T13:30:00Z")).toHaveLength(0);
  expect(rows(job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-30T06:00:00Z", piesaUnlockedAt: "2026-10-30T06:00:00Z", piesaCompleted: true }), "2026-11-16T13:30:00Z")).toHaveLength(0);
});
test("Install line: deposit paid / not paid / unknown", () => {
  const at = "2026-11-09T00:00:00Z", base = { readyCheckBooked: true, daysRemaining: 5, deadline: "2026-11-14" };
  expect(rows(job({ ...base, depositPaid: true }), at)[0]?.line).toBe("Install not booked · 5 days left · deposit paid");
  expect(rows(job({ ...base, depositPaid: false }), at)[0]?.line).toBe("Install not booked · 5 days left · deposit not paid");
  expect(rows(job({ ...base, depositPaid: null }), at)[0]?.line).toBe("Install not booked · 5 days left");
  expect(rows(job({ ...base, daysRemaining: -1, depositPaid: true }), at)[0]?.line).toBe("Install not booked · 30-day window expired · deposit paid");
  expect(rows(job({ ...base, daysRemaining: null }), at)).toHaveLength(0);
});
test("install unbooked at seven or fewer recorded days remaining, not eight; booking clears it", () => {
  for (const daysRemaining of [7, 0, -1]) expect(rows(job({ readyCheckBooked: true, daysRemaining, deadline: "2026-11-16" }), "2026-11-09T00:00:00Z").map(r => r.kind)).toEqual(["in_house_install_not_booked"]);
  expect(rows(job({ readyCheckBooked: true, daysRemaining: 8 }), "2026-11-09T00:00:00Z")).toHaveLength(0);
  expect(rows(job({ readyCheckBooked: true, daysRemaining: 7, installationBooked: true }), "2026-11-09T00:00:00Z")).toHaveLength(0);
});
test("deleted and qa_test jobs never raise in-house alerts", () => {
  for (const extra of [{ deletedAt: "2026-11-01" }, { source: "qa_test" }, { isTest: true }]) expect(rows({ ...job(), ...extra }, "2026-11-09T06:00:00Z")).toHaveLength(0);
});
test("one pile per job and no in-house alert once assignments ended", () => {
  const f = job({ quoteAcceptedAt: "2026-10-30T06:00:00Z", daysRemaining: 7 });
  const g = buildNeedsRows({ now: Date.parse("2026-11-09T06:00:00Z"), jobs: [f] });
  expect([...g.today, ...g.week, ...g.watch]).toHaveLength(1);
  expect(rows({ ...f, inHouse: null }, "2026-11-09T06:00:00Z")).toHaveLength(0);
});test("PIESA clock starts when the $349 clears, not at quote acceptance", () => {
  const f = job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-20T06:00:00Z", piesaUnlockedAt: "2026-10-30T06:00:00Z" });
  expect(rows(f, "2026-11-16T12:00:00Z")).toHaveLength(0);
  expect(rows(f, "2026-11-16T13:30:00Z").map(r => r.kind)).toEqual(["in_house_piesa_overdue"]);
  expect(rows(job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-01T06:00:00Z", piesaUnlockedAt: null }), "2026-11-16T13:30:00Z")).toHaveLength(0);
});
