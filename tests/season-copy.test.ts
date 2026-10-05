import { expect, test } from "bun:test";
import { resolveSeason, seasonCopy } from "../src/lib/season-copy.core";

test("defaults to summer cooler wording", () => {
  expect(resolveSeason(undefined)).toBe("summer");
  expect(resolveSeason("spring")).toBe("summer");
  expect(seasonCopy(null).myJobHeadline).toBe("Your cooler home is on its way");
  expect(seasonCopy("summer").bookingHeadline).toBe("Two visits, then you're cooler");
  expect(seasonCopy("summer").referralHeadline).toBe("Know someone with a hot house?");
  expect(seasonCopy("summer").allDoneHeadline).toBe("Your home is cooler");
});

test("winter switches every line to warm wording", () => {
  const w = seasonCopy("winter");
  expect(w.myJobHeadline).toBe("Your warmer home is on its way");
  expect(w.allDoneHeadline).toBe("Your home is warmer");
  expect(w.bookingHeadline).toBe("Two visits, then you're warm");
  expect(w.referralHeadline).toBe("Know someone with a cold house?");
});
