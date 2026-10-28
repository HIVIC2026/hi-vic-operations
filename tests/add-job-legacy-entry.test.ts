import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { partnerPathAllowed, type Access } from "../src/lib/route-guards";
import { partnerLegacyTarget } from "../src/lib/legacy-links.core";

const base: Access = { admin: false, installer: true, electrician: false, owner: false, businessAdmin: false, installerBusinessAdmin: false };

test("A4: no bulk upload page or link; old address lands on Add a job", () => {
  expect(existsSync("src/routes/_authenticated/partner.bulk-import.tsx")).toBe(false);
  expect(partnerLegacyTarget("bulk-import")).toEqual({ to: "/partner/import" });
  expect(readFileSync("src/lib/route-guards.ts", "utf8")).not.toContain("bulk-import");
  for (const f of ["src/routeTree.gen.ts", "src/components/trade/TradeShell.tsx", "src/components/portal/trade-work.tsx", "src/components/portal/AppShell.tsx", "scripts/installer-test.ts", "scripts/trade-shots.ts", "scripts/reinsulate-shots.ts", "scripts/portal-qa-coverage.ts"])
    expect(readFileSync(f, "utf8")).not.toContain("/partner/bulk-import");
});
test("business owner can open Add a job", () => {
  const boss = { ...base, businessAdmin: true, installerBusinessAdmin: true };
  expect(partnerPathAllowed("/partner/import", boss)).toBe(true);
});
test("server refuses installer batch create/review/confirm while switched off; links are hidden", () => {
  const fns = readFileSync("src/lib/bulk-import.functions.ts", "utf8");
  expect(fns.match(/requireBulkUploadOpen\(!!isAdmin\)/g)?.length).toBe(3);
  // Decision 42 / mock-ups M3 and M7 (decisions 192, 204): neither Add a job nor My business carries a bulk-upload link any more
  // (installer audit 24 Oct: "Upload multiple jobs" link removed); the server switch alone keeps installers out.
  for (const f of ["src/routes/_authenticated/partner.import.tsx", "src/routes/_authenticated/field.business.tsx"]) expect(readFileSync(f, "utf8")).not.toContain("bulk-import");
});
test("team management is business owner/admin only", () => {
  expect(partnerPathAllowed("/partner/workers", base)).toBe(false);
  expect(partnerPathAllowed("/partner/workers", { ...base, businessAdmin: true })).toBe(true);
});
