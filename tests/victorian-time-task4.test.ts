import { expect, test } from "bun:test";
import { endOfMelbourneDay } from "../src/lib/waiting.core";
import { installDaysLeft, shouldFlagTenDaysLeft } from "../src/lib/install-days.core";
import { credentialState } from "../src/lib/pilot.core";
import { resolveMittiProduct } from "../src/lib/insulation-product.core";

for (const [instant, date, end] of [
  ["2026-04-04T14:00:00Z", "2026-04-05", "2026-04-05T13:59:59.999Z"],
  ["2026-04-05T13:00:00Z", "2026-04-05", "2026-04-05T13:59:59.999Z"],
  ["2026-10-03T15:00:00Z", "2026-10-04", "2026-10-04T12:59:59.999Z"],
  ["2026-10-04T12:00:00Z", "2026-10-04", "2026-10-04T12:59:59.999Z"],
] as const) {
  test(`${date} at ${instant}: Victorian end-of-day uses the actual DST transition`, () => { expect(endOfMelbourneDay(instant)).toBe(end); });
  test(`${date} at ${instant}: 10 calendar days left triggers the office flag`, () => {
    const deadline = date === "2026-04-05" ? "2026-04-15" : "2026-10-14";
    expect(installDaysLeft(deadline, new Date(instant))).toBe(10);
    expect(shouldFlagTenDaysLeft({ deadline, booked: false, flaggedAt: null, now: new Date(instant) })).toBe(true);
  });
}
test("summer credential expiry is the Victorian end of the day, not +10", () => {
  expect(credentialState({ expires_at: "2026-10-04" }, new Date("2026-10-04T13:30:00Z"))).toBe("expired");
});
for (const answer of ["ECOWOOL", "ECOWOOL R5", " ecowool r5 "]) test(`${answer} cannot authorise a product without its warranty`, () => {
  expect(resolveMittiProduct(answer)).toEqual({ ready: false, product: null, source: "mitti_form", reasons: ["Office needs to: confirm insulation product"] });
});