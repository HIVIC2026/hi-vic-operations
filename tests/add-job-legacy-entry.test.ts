import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALLER_BULK_UPLOAD_ENABLED, legacyBulkImportRedirect, partnerPathAllowed, type Access } from "../src/lib/route-guards";

const base: Access = { admin: false, installer: true, electrician: false, owner: false, businessAdmin: false, installerBusinessAdmin: false };

test("ordinary installer staff are sent from batch upload to single Add job", () => {
  expect(legacyBulkImportRedirect(base)).toBe("/partner/import");
  expect(partnerPathAllowed("/partner/bulk-import", base)).toBe(false);
});
test("installer batch upload is switched off: business owner/admin goes to Add job (Start in Mitti)", () => {
  const boss = { ...base, businessAdmin: true, installerBusinessAdmin: true };
  expect(INSTALLER_BULK_UPLOAD_ENABLED).toBe(false);
  expect(legacyBulkImportRedirect(boss)).toBe("/partner/import");
  expect(partnerPathAllowed("/partner/bulk-import", boss)).toBe(false);
  expect(partnerPathAllowed("/partner/import", boss)).toBe(true);
});
test("installer business owner/admin could open batch upload if the switch is turned back on", () => {
  expect(legacyBulkImportRedirect({ ...base, businessAdmin: true, installerBusinessAdmin: true }, true)).toBeNull();
  expect(legacyBulkImportRedirect(base, true)).toBe("/partner/import");
});
test("server refuses installer batch create/review/confirm while switched off; links are hidden", () => {
  const fns = readFileSync("src/lib/bulk-import.functions.ts", "utf8");
  expect(fns.match(/requireBulkUploadOpen\(!!isAdmin\)/g)?.length).toBe(3);
  for (const f of ["src/routes/_authenticated/partner.import.tsx", "src/routes/_authenticated/field.business.tsx"]) expect(readFileSync(f, "utf8")).toContain("INSTALLER_BULK_UPLOAD_ENABLED && ");
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
