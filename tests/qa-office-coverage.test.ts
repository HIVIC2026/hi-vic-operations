import { beforeEach, expect, mock, test } from "bun:test";
// Jo 27 Oct: TEST office coverage lookup lists TEST partners only; admin's list is unchanged.
let role: "qa_office" | "admin" = "qa_office";
const jobId = "00000000-0000-4000-8000-0000000000aa";
const TEST_INSTALLER = "00000000-0000-4000-8000-000000000001", TEST_REC = "00000000-0000-4000-8000-000000000003";
const REAL_INSTALLER = "00000000-0000-4000-8000-000000000002", REAL_REC = "00000000-0000-4000-8000-000000000004";
mock.module("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (d: unknown) => d;
  const chain = { middleware: () => chain, inputValidator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: (a: unknown) => unknown) => (a: { data: unknown; context: unknown }) => fn({ ...a, data: validate(a.data) }) };
  return chain;
} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, logEvent: async () => {}, requireAdmin: async () => { if (role !== "admin") throw new Error("Admin only"); } }));
mock.module("../src/lib/qa-office-access.server", () => ({
  requireOfficeJob: async () => role, officeTestBusinessIds: async () => { if (role !== "qa_office") throw new Error("Dedicated TEST office required."); return [TEST_INSTALLER, TEST_REC]; },
}));
const biz = (id: string, name: string, type: string) => ({ id, name, trading_name: name, business_type: type, capabilities: [type === "installer" ? "installer" : "rec"], onboarding_status: "approved", is_active: true, service_postcodes: ["3199"], service_regions: [], coverage_verified_at: "2026-10-01", declared_service_origin: null, declared_travel_radius_km: null, declared_excluded_areas: null, free_measureups_for_hivic_quote_leads: false });
const rows: Record<string, unknown[]> = {
  businesses: [biz(TEST_INSTALLER, "TEST Alpha", "installer"), biz(REAL_INSTALLER, "Real Insulation Co", "installer"), biz(TEST_REC, "TEST Delta", "rec"), biz(REAL_REC, "Real Sparks", "rec")],
  business_credentials: [], partner_workers: [], business_members: [],
  jobs: [{ id: jobId, job_number: "HV-T1", stage: "spot_saved", source: "qa_test", properties: { address_line: "1 Test St", suburb: "Frankston", postcode: "3199" } }],
};
const q = (t: string) => { const r = { data: rows[t] ?? [], error: null }; const o: Record<string, unknown> = { then: (f: (x: unknown) => unknown) => Promise.resolve(r).then(f) }; for (const m of ["select", "not", "is", "eq"]) o[m] = () => o; return o; };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
// Echo every partner the lookup considers, so the test sees exactly which partners reach the list.
mock.module("../src/lib/coverage.core", () => ({ tradeCoverage: (ps: { name: string }[], kind: string) => ({ state: "serviceable", matches: ps.filter((p) => (kind === "rec") === / (Delta|Sparks)$/.test(p.name)).map((p) => ({ name: p.name })) }), overallCoverage: () => "serviceable", coverageAreas: () => [], coveragePartnerBlocker: () => null }));
const fns = await import("../src/lib/coverage.functions");
const policy = await import("../src/lib/qa-office-policy.core");
const names = (c: { rec: { matches: { name: string }[] }; installer: { matches: { name: string }[] } }) => [...c.installer.matches, ...c.rec.matches].map((m) => m.name).sort();
const call = () => (fns.getJobCoverage as unknown as (a: unknown) => Promise<Parameters<typeof names>[0]>)({ data: { jobId }, context: { supabase: {} } });
beforeEach(() => { role = "qa_office"; });

test("TEST office coverage list contains zero real installers or electricians", async () => {
  expect(names(await call())).toEqual(["TEST Alpha", "TEST Delta"]);
});
test("admin coverage list is unchanged (real partners still listed)", async () => {
  role = "admin";
  expect(names(await call())).toEqual(["Real Insulation Co", "Real Sparks", "TEST Alpha", "TEST Delta"]);
});
test("only the coverage lookup is newly allowed; the coverage email stays refused", () => {
  expect(policy.qaOfficeFunctionAllowed("src/lib/coverage.functions.ts", "getJobCoverage")).toBe(true);
  expect(policy.qaOfficeFunctionAllowed("src/lib/coverage.functions.ts", "sendNoCoverageEmail")).toBe(false);
  expect(policy.qaOfficeFunctionAllowed("src/lib/spot-release.functions.ts", "releaseSpotFn")).toBe(true);
});
