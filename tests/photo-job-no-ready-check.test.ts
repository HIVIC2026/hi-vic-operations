// Photo-quote installers Task 4: photo jobs get no Ready Check form, chase or flag; a 2-business-day photo quote flag instead.
import { expect, test } from "bun:test";
import { needsCandidates, type NeedsFacts } from "../src/lib/office-needs.core";
import { cardOf } from "../src/lib/needs-cards.core";

// Given Fri 6 Nov 2026 10:00 Melbourne (AEDT, UTC+11).
const given = "2026-11-05T23:00:00Z";
const job = (extra = {}): NeedsFacts => ({ jobId: "one", jobNumber: "HV-1", surname: "Smith", suburb: "Richmond", inHouse: {
  partnerName: "No Gap Insulation", batchSentAt: given, readyCheckBooked: false,
  quoteAcceptedAt: null, piesaCompleted: false, installationBooked: false, daysRemaining: null, deadline: null, piesaBooked: false, depositPaid: null,
  quoteMethod: "photos", photoQuoteSent: false, ...extra,
} });
const kinds = (f: NeedsFacts, at: string) => needsCandidates(f, Date.parse(at)).filter(r => r.kind.startsWith("in_house_")).map(r => [r.kind, r.line]);

test("photos job given Fri 6 Nov: no flag Tue 10 Nov, flag Wed 11 Nov", () => {
  expect(kinds(job(), "2026-11-10T12:00:00Z")).toEqual([]);
  expect(kinds(job(), "2026-11-10T13:30:00Z")).toEqual([["in_house_photo_quote_overdue", "Photo quote not sent after 2 business days"]]);
});
test("photos job never gets the Ready Check not booked flag", () => {
  for (const at of ["2026-11-13T13:30:00Z", "2026-11-20T13:30:00Z", "2026-12-20T13:30:00Z"])
    expect(kinds(job(), at).some(([k]) => k === "in_house_ready_check_not_booked")).toBe(false);
});
test("the flag clears once the photo quote is submitted", () => {
  expect(kinds(job({ photoQuoteSent: true }), "2026-11-20T13:30:00Z")).toEqual([]);
});
test("Ready Check jobs keep the 5-day flag", () => {
  expect(kinds(job({ quoteMethod: "ready_check", batchSentAt: "2026-10-30T06:00:00Z" }), "2026-11-09T13:30:00Z")).toEqual([["in_house_ready_check_not_booked", "Ready Check not booked after 5 business days"]]);
});
test("needs card maps the photo flag to other, rank 91 week", () => {
  expect(cardOf("in_house_photo_quote_overdue")).toBe("other");
  const r = needsCandidates(job(), Date.parse("2026-11-11T13:30:00Z")).find(r => r.kind === "in_house_photo_quote_overdue")!;
  expect([r.rank, r.group]).toEqual([91, "week"]);
});
