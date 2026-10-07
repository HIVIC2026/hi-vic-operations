import { expect, test } from "bun:test";
import { reviewRowNotes, siteCheckFromFile } from "../src/lib/bulk-import.core";

test("a quoted price alone never means the site check was done", () => {
  expect(siteCheckFromFile({ price_inc_gst: 3200 } as never).check).toBeNull();
  expect(siteCheckFromFile({ site_check: "yes" } as never).check).toBe("yes");
});
test("site check Yes never shows 'Needs a visit' or Ready Check gaps", () => {
  const r = reviewRowNotes("needs_visit", ["Stage: Visited", "Missing: ceiling access — a Ready Check visit is needed", "Files matched by filename only — please check"], "yes");
  expect(r.tag).toBe("Site check done — no Ready Check needed");
  expect(r.notes).toEqual(["Files matched by filename only — please check"]);
  expect(reviewRowNotes("needs_visit", [], null).tag).toMatch(/Please answer/);
  expect(reviewRowNotes("office_review", ["No address found — please add it in the review table"], "yes").notes).toHaveLength(1);
});
