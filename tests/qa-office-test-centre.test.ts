import { expect, test } from "bun:test";
import { qaOfficeFunctionAllowed, qaOfficeRouteAllowed } from "../src/lib/qa-office-policy.core";

// Jo 30 Oct: TEST office login can use a cut-down Test Centre, TEST jobs only.
const TA = "src/lib/test-accounts.functions.ts";
const PF = "src/lib/portal.functions.ts";
const OL = "src/lib/onboarding-links.functions.ts";

test("TEST office may open the Test Centre", () => expect(qaOfficeRouteAllowed("/admin/test-centre")).toBe(true));

for (const [file, fn] of [[TA, "prepareQaJourneyAccess"], [TA, "issueQaPersonaLink"], [TA, "issueQaWorkerLink"], [TA, "simulateQaJourneyTime"], [TA, "simulateQaPayment"], [TA, "archiveQaJourney"], [PF, "createTestEnquiry"], [PF, "getQaJourneys"]] as const)
  test(`TEST office allowed: ${fn}`, () => expect(qaOfficeFunctionAllowed(file, fn)).toBe(true));

for (const [file, fn] of [[TA, "createTestTradeAccounts"], [PF, "getAdminPipeline"], [OL, "issueOnboardingLink"], [OL, "revokeOnboardingLink"], [OL, "listOnboardingLinks"], [OL, "listOnboardingStartBlocks"], [OL, "clearOnboardingStartBlock"], [OL, "runOnboardingUploadCleanup"]] as const)
  test(`TEST office still blocked: ${fn}`, () => expect(qaOfficeFunctionAllowed(file, fn)).toBe(false));

// ---- Task 2: actions accept the TEST office, TEST jobs only ----
import { requireQaAdmin, requireQaJob } from "../src/lib/qa-access.server";
const ctx = (roles: string[]) => ({ userId: "u1", supabase: { rpc: async (_: string, a: { _role: string }) => ({ data: roles.includes(a._role), error: null }) } }) as never;
const jobDb = (job: Record<string, unknown>) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job, error: null }) }) }) }) }) as never;
const base = { id: "j1", owner_id: "o1", source: "qa_test", qa_archived_at: null, deleted_at: null };
for (const [name, job] of [["real job", { ...base, source: "website" }], ["archived TEST job", { ...base, qa_archived_at: "2026-10-30" }], ["deleted TEST job", { ...base, deleted_at: "2026-10-30" }]] as const)
  test(`Test Centre actions refuse a ${name}`, async () => { await expect(requireQaJob(jobDb(job), "j1")).rejects.toThrow("only available for an active TEST journey"); });
test("Test Centre actions accept an active TEST job", async () => { await expect(requireQaJob(jobDb(base), "j1")).resolves.toMatchObject({ id: "j1" }); });
test("other TEST tools (Dad, TestRigor logins) stay admin-only", async () => { await expect(requireQaAdmin(ctx(["qa_office"]))).rejects.toThrow("Admin only."); });
import { readFileSync } from "node:fs";
test("only the six journey actions accept the TEST office; trade accounts stay admin-only", () => {
  const src = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
  const body = (name: string) => src.slice(src.indexOf(`export const ${name} =`), src.indexOf("});", src.indexOf(`export const ${name} =`)));
  for (const fn of ["prepareQaJourneyAccess", "issueQaPersonaLink", "issueQaWorkerLink", "simulateQaJourneyTime", "simulateQaPayment", "archiveQaJourney"]) expect(body(fn)).toContain("await requireTestOfficeOrAdmin(context, data.jobId)");
  expect(body("createTestTradeAccounts")).toContain("await requireTestAdmin(context)");
  expect(body("createTestTradeAccounts")).not.toContain("requireTestOfficeOrAdmin");
});

// ---- Task 3: TEST office journeys must use a TEST owner email ----
import { isQaTestEmail } from "../src/lib/qa-email.core";
for (const e of ["o@hivic-test.example", " O@HIVIC-TEST.EXAMPLE "]) test(`TEST email: ${JSON.stringify(e)}`, () => expect(isQaTestEmail(e)).toBe(true));
for (const e of ["x@gmail.com", "x@hivic-test.example.com", "hivic-test.example", "", "a b@hivic-test.example"]) test(`not a TEST email: ${JSON.stringify(e)}`, () => expect(isQaTestEmail(e)).toBe(false));
import { testEnquiryBlocker, QA_TEST_EMAIL_RULE, QA_TEST_EMAIL_IN_USE } from "../src/lib/qa-email.core";
test("admin can create a test journey with any email (unchanged)", () => expect(testEnquiryBlocker({ admin: true, qaOffice: false }, "jo@gmail.com")).toBeNull());
test("TEST office: TEST email allowed", () => expect(testEnquiryBlocker({ admin: false, qaOffice: true }, "owner1@hivic-test.example")).toBeNull());
test("TEST office: real email refused", () => expect(testEnquiryBlocker({ admin: false, qaOffice: true }, "someone@gmail.com")).toBe(QA_TEST_EMAIL_RULE));
test("neither role, or both, refused", () => { expect(testEnquiryBlocker({ admin: false, qaOffice: false }, "o@hivic-test.example")).toBe("Admin only."); expect(testEnquiryBlocker({ admin: true, qaOffice: true }, "o@hivic-test.example")).toBe("Admin only."); });
test("createTestEnquiry uses the rule and still makes qa_test jobs", () => {
  const src = readFileSync("src/lib/portal.functions.ts", "utf8");
  const body = src.slice(src.indexOf("export const createTestEnquiry ="), src.indexOf("export const setEligibility"));
  expect(body).toContain("testEnquiryBlocker(");
  expect(body).toContain('"qa_test"');
});

// ---- Task 4: TEST-only journeys list ----
import { activeQaJobsFilter } from "../src/lib/qa-journeys.core";
test("TEST journeys list only ever reads active TEST jobs", () => expect(activeQaJobsFilter).toEqual({ source: "qa_test", qa_archived_at: null, deleted_at: null }));
test("getQaJourneys applies the filter and checks the caller", () => {
  const src = readFileSync("src/lib/portal.functions.ts", "utf8");
  const body = src.slice(src.indexOf("export const getQaJourneys ="));
  const fn = body.slice(0, body.indexOf("});") + 3);
  expect(fn).toContain("requireOfficeIdentity(context.supabase)");
  expect(fn).toContain('.eq("source", activeQaJobsFilter.source)');
  expect(fn).toContain('.is("qa_archived_at", null)');
  expect(fn).toContain('.is("deleted_at", null)');
});

// ---- Task 5: cut-down Test Centre page for the TEST office ----
test("Test Centre page: TEST office gets TEST jobs list + create form only; admin unchanged", () => {
  const src = readFileSync("src/routes/_authenticated/admin.test-centre.tsx", "utf8");
  expect(src).toContain("Route.useRouteContext()");
  expect(src).toContain("qaOffice ? getQaJourneys : getAdminPipeline");
  for (const admin of ["<JoTradiePanel />", "<TestTradeAccounts />", "<OnboardingLinks />", "<OnboardingLimits />"]) {
    expect(src).not.toContain(`\n      ${admin}\n`); // no longer shown unconditionally
    expect(src).toContain(`{!qaOffice && ${admin}}`);
  }
  expect(src).toContain("<CreateTestJob ");
});

// ---- Review fixes (30 Oct) ----
// #1: journey actions and the list use the full TEST-isolation check (requireOfficeJob / officeTestJobIds),
//     not just source = qa_test, so an admin-made test journey holding real details is refused to the TEST office.
test("review #1: every journey action runs the full isolation check on its job", () => {
  const src = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
  const body = (name: string) => src.slice(src.indexOf(`export const ${name} =`), src.indexOf("});", src.indexOf(`export const ${name} =`)));
  for (const fn of ["prepareQaJourneyAccess", "issueQaPersonaLink", "issueQaWorkerLink", "simulateQaJourneyTime", "simulateQaPayment", "archiveQaJourney"]) expect(body(fn)).toContain("await requireTestOfficeOrAdmin(context, data.jobId)");
  const helper = src.slice(src.indexOf("async function requireTestOfficeOrAdmin("), src.indexOf("async function testJob("));
  expect(helper).toContain("requireOfficeJob(context.supabase, jobId)");
});
test("review #1: TEST office list comes from officeTestJobIds", () => {
  const src = readFileSync("src/lib/portal.functions.ts", "utf8");
  const fn = src.slice(src.indexOf("export const getQaJourneys ="), src.indexOf("export const getAdminPipeline ="));
  expect(fn).toContain("officeTestJobIds(context.supabase)");
});
// #2: the TEST office can't create a journey with an email that already belongs to a portal account.
test("review #2: TEST office refused an email that already has a portal account", () =>
  expect(testEnquiryBlocker({ admin: false, qaOffice: true }, "qa.office@hivic-test.example", { emailHasAccount: true })).toBe(QA_TEST_EMAIL_IN_USE));
test("review #2: admin unchanged even if the email has an account", () =>
  expect(testEnquiryBlocker({ admin: true, qaOffice: false }, "jo@gmail.com", { emailHasAccount: true })).toBeNull());
test("review #2: createTestEnquiry checks for an existing account for the TEST office", () => {
  const src = readFileSync("src/lib/portal.functions.ts", "utf8");
  const body = src.slice(src.indexOf("export const createTestEnquiry ="), src.indexOf("export const setEligibility"));
  expect(body).toContain("emailHasAccount");
});