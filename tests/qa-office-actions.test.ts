import { expect, mock, test, beforeEach } from "bun:test";
let role = "qa_office", effects = 0;
const testJob = "00000000-0000-4000-8000-000000000001", realJob = "00000000-0000-4000-8000-000000000002", business = "00000000-0000-4000-8000-000000000003";
mock.module("@tanstack/react-start", () => ({ createServerFn: () => { let validate = (d: unknown) => d; const chain = { middleware: () => chain, inputValidator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }) }; return chain; } }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: Error, logEvent: async () => { effects++; }, requireAdmin: async () => { if (role !== "admin") throw new Error("Admin only"); } }));
mock.module("../src/lib/qa-office-access.server", () => ({ requireOfficeIdentity: async () => role, officeTestBusinessIds: async () => [business], officeTestJobIds: async () => [testJob], requireOfficeJob: async (_sb: unknown, jobId: string) => { if (role === "qa_office" && jobId !== testJob) throw new Error("Only TEST jobs"); return role; }, requireOfficeBusiness: async (_sb: unknown, id: string) => { if (role === "qa_office" && id !== business) throw new Error("Only TEST businesses"); } }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { effects++; throw new Error("domain reached"); } } }));
mock.module("../src/lib/ap-approve.server", () => ({ approveApJobAs: async () => { effects++; return { ok: true }; } }));
mock.module("../src/lib/final-check.server", () => ({ finalCheckScreen: async () => { effects++; return { ok: true }; } }));
mock.module("../src/lib/electrician-form-approval.server", () => ({ recordElectricianFormApproval: async () => { effects++; return { ok: true }; } }));
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStateFor: async () => { effects++; return { state: "none" }; }, releaseSpot: async () => { effects++; return { mode: "released", installer: "TEST" }; } }));
const office = await import("../src/lib/office.functions");
const ap = await import("../src/lib/ap-queue.functions");
const release = await import("../src/lib/spot-release.functions");
const offer = await import("../src/lib/offer-dispatch.functions");
const invoke = (fn: unknown, data: unknown) => (fn as (args: unknown) => Promise<unknown>)({ data, context: { supabase: {}, userId: "office" } });
beforeEach(() => { role = "qa_office"; effects = 0; });
for (const [label, fn, extra] of [
 ["electrician Approve", office.approveElectricianForm, { kind: "assessment" }],
 ["payout Mark paid", office.markPayoutPaid, { kind: "assessment", reference: "TEST reference" }],
 ["Final check Approve", ap.approveApJob, {}],
 ["Final check read", ap.getFinalCheck, {}],
 ["release state read", release.getSpotRelease, {}],
 ["choose trades read", offer.listChooseTrades, { kind: "ready_check" }],
 ["release", release.releaseSpotFn, { businessId: business }],
 ["send chosen offer", offer.sendChosenOffers, { kind: "ready_check", businessIds: [business] }],
] as const) test(`${label} refuses real job before any effect; admin retains original path`, async () => {
 await expect(invoke(fn, { jobId: realJob, ...extra })).rejects.toThrow("Only TEST jobs"); expect(effects).toBe(0);
 role = "admin"; try { await invoke(fn, { jobId: realJob, ...extra }); } catch (e) { expect((e as Error).message).not.toBe("Only TEST jobs"); } expect(effects).toBeGreaterThan(0);
});
test("release refuses real target business even on a TEST job", async () => {
 await expect(invoke(release.releaseSpotFn, { jobId: testJob, businessId: realJob })).rejects.toThrow("Only TEST businesses"); expect(effects).toBe(0);
});