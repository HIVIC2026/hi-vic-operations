import { expect, test } from "bun:test";
import { leadStage, effectiveSiteCheck, memberSizeGate, MAX_MEMBER_BYTES, MAX_UPLOAD_TOTAL_BYTES } from "../src/lib/bulk-import.core";

test("price, area, photos or documents alone never mean visited (Jo 20 Oct)", () => {
  expect(leadStage({ price_inc_gst: 4000 }, 0)).toBe("not_visited");
  expect(leadStage({ area_m2: 120 }, 0)).toBe("not_visited");
  expect(leadStage({ full_name: "A" }, 5)).toBe("not_visited");
  expect(effectiveSiteCheck({ area_m2: 120, price_inc_gst: 3000 }, 3).check).toBeNull(); // unknown stays unknown
});
test("explicit answers stay independent", () => {
  expect(leadStage({ site_check: "yes" })).toBe("visited");
  expect(leadStage({ site_check: "yes", price_inc_gst: 3450 })).toBe("quoted");
  expect(leadStage({ site_check: "no", price_inc_gst: 3450 })).toBe("not_visited");
  expect(leadStage({ site_check: "yes" }, 4)).toBe("visited"); // photos never make it quoted
});
test("size gate runs on declared size before reading; bounded total", () => {
  expect(memberSizeGate(MAX_MEMBER_BYTES + 1, 0)).toMatchObject({ ok: false, message: expect.stringMatching(/evidence page/) });
  expect(memberSizeGate(10, MAX_UPLOAD_TOTAL_BYTES - 5).ok).toBe(false);
  expect(memberSizeGate(undefined, 0).ok).toBe(false);
  expect(memberSizeGate(1_000_000, 0).ok).toBe(true);
});
