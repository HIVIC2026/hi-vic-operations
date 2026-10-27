import { expect, test } from "bun:test";
import { qaOfficeFunctionAllowed, qaOfficeFunctionBlocker, qaOfficeRouteAllowed, TEST_OFFICE_UNAVAILABLE } from "../src/lib/qa-office-policy.core";
import { portalDestination } from "../src/lib/set-password-link.core";
const qa = { roles: ["qa_office"], email: "office@hivic-test.example", emailVerified: true };
for (const path of ["/admin/enquiries", "/admin/jobs/active", "/admin/needs-me", "/admin/jobs/00000000-0000-4000-8000-000000000001"]) test(`journey route allowed: ${path}`, () => expect(qaOfficeRouteAllowed(path)).toBe(true));
test("Money allows payouts only", () => { expect(qaOfficeRouteAllowed("/admin/money", "?tab=payouts")).toBe(true); for (const search of ["", "?tab=prices", "?tab=overview", "?tab=veecs"]) expect(qaOfficeRouteAllowed("/admin/money", search)).toBe(false); });
for (const path of ["/admin/partners", "/admin/emails", "/admin/settings", "/admin/users", "/admin/templates", "/admin/jobs/closed", "/admin/exports", "/admin/new-screen"]) test(`default denied route: ${path}`, () => expect(qaOfficeRouteAllowed(path)).toBe(false));
for (const [file, fn] of [["src/lib/office-settings.functions.ts", "saveOfficeSettings"], ["src/lib/office-money.functions.ts", "saveVeecSpotPrice"], ["src/lib/portal.functions.ts", "setUserRole"], ["src/lib/jobfile.functions.ts", "exportJobPack"], ["src/lib/new.functions.ts", "getOfficeJobPage"]]) test(`default denied function: ${fn}`, () => {
 expect(qaOfficeFunctionAllowed(file, fn)).toBe(false);
 expect(qaOfficeFunctionBlocker(qa, file, fn)).toBe(TEST_OFFICE_UNAVAILABLE);
 expect(qaOfficeFunctionBlocker({ ...qa, roles: ["admin"], email: "admin@example.com" }, file, fn)).toBeNull();
});
test("unverified and mixed role TEST office cannot use allowed functions", () => {
 expect(qaOfficeFunctionBlocker({ ...qa, emailVerified: false }, "src/lib/office-screens.functions.ts", "getOfficeJobPage")).not.toBeNull();
 expect(qaOfficeFunctionBlocker({ ...qa, roles: ["admin", "qa_office"] }, "src/lib/office-screens.functions.ts", "getOfficeJobPage")).not.toBeNull();
});
test("dedicated TEST office home; ordinary admin destination unchanged", () => {
 expect(portalDestination({ roles: ["qa_office"], hasBusiness: false })).toBe("/admin/needs-me");
 expect(portalDestination({ roles: ["qa_office", "admin"], hasBusiness: false })).toBe("no-access");
 expect(portalDestination({ roles: ["admin"], hasBusiness: false })).toBe("/admin/needs-me");
});