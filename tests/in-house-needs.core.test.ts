import { expect, test } from "bun:test";
import { buildNeedsRows, needsCandidates, type NeedsFacts } from "../src/lib/office-needs.core";

const job = (extra = {}): NeedsFacts => ({ jobId: "one", jobNumber: "HV-1", surname: "Smith", suburb: "Richmond", inHouse: {
  partnerName: "Rapid Insulation", batchSentAt: "2026-10-30T06:00:00Z", readyCheckBooked: false,
  quoteAcceptedAt: null, piesaCompleted: false, installationBooked: false, daysRemaining: null, deadline: null,
  ...extra,
} });
const rows = (f: NeedsFacts, at: string) => needsCandidates(f, Date.parse(at)).filter(r => r.kind.startsWith("in_house_"));
test("Ready Check is not overdue on Wednesday 4 Nov but is on Monday 9 Nov", () => {
  expect(rows(job(), "2026-11-04T06:00:00Z")).toHaveLength(0);
  expect(rows(job(), "2026-11-09T00:00:00Z").map(r => r.kind)).toEqual(["in_house_ready_check_not_booked"]);
  expect(rows(job({ readyCheckBooked: true }), "2026-11-09T00:00:00Z")).toHaveLength(0);
});
test("PIESA overdue exactly ten calendar days after accepted quote; completed records clear it", () => {
  const f = job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-30T06:00:00Z" });
  expect(rows(f, "2026-11-09T05:59:59Z")).toHaveLength(0);
  expect(rows(f, "2026-11-09T06:00:00Z").map(r => r.kind)).toEqual(["in_house_piesa_overdue"]);
  expect(rows(job({ readyCheckBooked: true, quoteAcceptedAt: "2026-10-30T06:00:00Z", piesaCompleted: true }), "2026-11-09T06:00:00Z")).toHaveLength(0);
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
});