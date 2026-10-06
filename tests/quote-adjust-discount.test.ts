import { expect, test } from "bun:test";
import { quoteAdjustmentDiscount } from "../src/lib/estimate.core";
test("review F: whole VEECs, $200 minimum, override", () => {
  expect(quoteAdjustmentDiscount(1470, 5000, 70, 200, false)).toEqual({ ok: true, discount: 1470, veecs: 21, reducedForMin: false });
  expect(quoteAdjustmentDiscount(1500, 5000, 70, 200, false).ok).toBe(false);
  expect(quoteAdjustmentDiscount(1500, 5000, 70, 200, true)).toEqual({ ok: true, discount: 1500, veecs: null, reducedForMin: false });
  expect(quoteAdjustmentDiscount(1470, 1500, 70, 200, false)).toEqual({ ok: true, discount: 1300, veecs: null, reducedForMin: true });
  expect(quoteAdjustmentDiscount(9999.99, 1500, 70, 200, true)).toMatchObject({ discount: 1300 });
});
import { couldntGetInBlocker } from "../src/lib/trade-view.core";
test("review E: couldn't get in only from a booked Ready Check on/after the Melbourne visit day", () => {
  const now = new Date("2026-10-06T22:00:00Z"); // 7 Oct 9am Melbourne
  expect(couldntGetInBlocker("ready_check_scheduled", "2026-10-06T23:00:00Z", now)).toBeNull(); // same Melbourne day
  expect(couldntGetInBlocker("ready_check_scheduled", "2026-10-07T23:00:00Z", now)).toMatch(/visit day/);
  expect(couldntGetInBlocker("installation_booked", "2026-10-06T23:00:00Z", now)).toMatch(/booked Ready Check/);
  expect(couldntGetInBlocker("ready_check_scheduled", null, now)).toMatch(/no booked/);
});
