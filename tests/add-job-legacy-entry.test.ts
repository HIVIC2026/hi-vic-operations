import { expect, test } from "bun:test";
import { legacyBulkImportRedirect, partnerPathAllowed, type Access } from "../src/lib/route-guards";

const base: Access = { admin: false, installer: true, electrician: false, owner: false, businessAdmin: false, installerBusinessAdmin: false };

test("ordinary installer staff are sent from batch upload to single Add job", () => {
  expect(legacyBulkImportRedirect(base)).toBe("/partner/import");
  expect(partnerPathAllowed("/partner/bulk-import", base)).toBe(false);
});
test("installer business owner/admin can open batch upload", () => {
  const boss = { ...base, businessAdmin: true, installerBusinessAdmin: true };
  expect(legacyBulkImportRedirect(boss)).toBeNull();
  expect(partnerPathAllowed("/partner/bulk-import", boss)).toBe(true);
});
test("office retains batch tools", () => {
  expect(legacyBulkImportRedirect({ ...base, admin: true })).toBeNull();
});
test("team management is business owner/admin only", () => {
  expect(partnerPathAllowed("/partner/workers", base)).toBe(false);
  expect(partnerPathAllowed("/partner/workers", { ...base, businessAdmin: true })).toBe(true);
});
test("electrician business admin cannot batch upload jobs", () => {
  expect(partnerPathAllowed("/partner/bulk-import", { ...base, installer: false, electrician: true, businessAdmin: true })).toBe(false);
});
