import { expect, test } from "bun:test";
import { buildNeedsRows } from "../src/lib/office-needs.core";
const job = { jobId: "one", jobNumber: "HV-TEST", surname: "Test", suburb: null };
test("48-hour unconfirmed visit has exactly one Needs me row", () => {
  const rows = buildNeedsRows({ now: Date.now(), jobs: [{ ...job, bookingOverdue: { at: "2026-10-25T12:00:00Z", visit: "ready_check" } }] });
  expect(Object.values(rows).flat().filter(r => r.jobId === "one").length).toBe(1);
  expect(Object.values(rows).flat()[0]?.kind).toBe("booking_overdue");
});
test("confirmed visit clears the fact and office row", () => {
  expect(Object.values(buildNeedsRows({ now: Date.now(), jobs: [job] })).flat().length).toBe(0);
});
for(const visit of ['piesa','installation'] as const)test(`in-house ${visit} unbooked for two business days appears in Needs me`,()=>{
 const rows=Object.values(buildNeedsRows({now:Date.parse('2026-11-09T03:00:00Z'),jobs:[{...job,inHouseDispatch:'in_house',bookingOverdue:{at:'2026-11-05T03:00:00Z',visit}}]})).flat();
 expect(rows).toHaveLength(1);expect(rows[0]?.kind).toBe('booking_overdue');
});
test('failed deposit intent is an office task',()=>{
 const rows=Object.values(buildNeedsRows({now:Date.now(),jobs:[{...job,depositRequestFailed:{at:'2026-11-01T00:00:00Z',reason:'Invoice unavailable'}}]})).flat();
 expect(rows[0]?.kind).toBe('install_deposit_request_failed');
});