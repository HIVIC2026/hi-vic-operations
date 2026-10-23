import { expect, test } from "bun:test";
import { ownerHeadline, quoteKicker, referralCopy } from "../src/lib/owner-headlines.core";

test("headlines use the real rebate", () => {
  expect(ownerHeadline("spot_saved", 1834.6)).toBe("Spot saved. Your $1,834 rebate is waiting.");
  expect(ownerHeadline("all_done", 1834)).toBe("$1,834 saved. Bills down. Job done.");
  expect(quoteKicker(1834)).toBe("You could save $1,834 on ceiling insulation.");
  expect(ownerHeadline("install_booked", 0)).toBe("Your rebate's locked in. Your installer's booked.");
});

test("government only on the quote; no season words", () => {
  const steps = ["spot_saved", "ready_check_booked", "quote_ready", "booking_visits", "install_booked", "all_done"] as const;
  const all = steps.map((s) => ownerHeadline(s, 1800)).concat(Object.values(referralCopy(1800)));
  expect(all.filter((t) => /government/i.test(t))).toHaveLength(0);
  for (const t of all) expect(t).not.toMatch(/warm|cold|cool|comf/i);
});

test("referral rounds typical rebate", () => {
  expect(referralCopy(1849).headline).toBe("Your mates are leaving $1,800 on the table");
});
