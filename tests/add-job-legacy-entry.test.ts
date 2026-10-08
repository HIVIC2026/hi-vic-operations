import { expect, test } from "bun:test";
import { legacyBulkImportRedirect } from "../src/lib/route-guards";

test("installer legacy bulk entry lands on current Add job instead of obsolete questions", () => {
  expect(legacyBulkImportRedirect({ admin: false })).toBe("/partner/import");
});
test("office retains historical batch tools", () => {
  expect(legacyBulkImportRedirect({ admin: true })).toBeNull();
});