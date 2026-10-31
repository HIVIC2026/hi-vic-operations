import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Live finding 31 Oct: the database's TEST office wall (migration 0174 qa_office_api_boundary) only lets the TEST office
// call a short list of Data API paths. rpc/has_role is NOT on it, so role checks for the TEST office must go through
// requireOfficeIdentity / requireOfficeJob (which use GET /user_roles and rpc/qa_office_job_allowed).
const wall = readFileSync("drizzle/migrations/0174_qa_office_api_boundary.sql", "utf8");
const slice = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

test("the database wall still refuses rpc/has_role for the TEST office (why this matters)", () => {
  expect(wall).not.toContain("/rpc/has_role");
  expect(wall).toContain("/user_roles");
  expect(wall).toContain("/rpc/qa_office_job_allowed");
});

test("Test Centre journey actions check the caller with requireOfficeJob only (no has_role)", () => {
  const src = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
  const helper = slice(src, "async function requireTestOfficeOrAdmin(", "async function testJob(");
  expect(helper).toContain("requireOfficeJob(context.supabase, jobId)");
  expect(helper).not.toContain('rpc("has_role"');
  expect(helper).not.toContain("requireQaJourneyActor");
});

test("getQaJourneys checks the caller with requireOfficeIdentity (no has_role)", () => {
  const src = readFileSync("src/lib/portal.functions.ts", "utf8");
  const fn = slice(src, "export const getQaJourneys =", "export const getAdminPipeline =");
  expect(fn).toContain("requireOfficeIdentity(context.supabase)");
  expect(fn).not.toContain('rpc("has_role"');
  expect(fn).not.toContain("requireQaJourneyActor");
});

test("createTestEnquiry checks the caller with requireOfficeIdentity (no has_role)", () => {
  const src = readFileSync("src/lib/portal.functions.ts", "utf8");
  const fn = slice(src, "export const createTestEnquiry =", "export const setEligibility");
  expect(fn).toContain("requireOfficeIdentity(context.supabase)");
  expect(fn).not.toContain('rpc("has_role"');
});
