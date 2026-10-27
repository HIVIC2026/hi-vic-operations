import { expect, mock, test } from "bun:test";
let status = "issued";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from() { const b: Record<string, unknown> = {}; for (const k of ["select","eq","order","limit","maybeSingle"]) b[k] = () => b; b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null })); return b; } } }));
mock.module("../src/lib/fixes-quote-current.server", () => ({ currentFixesQuote: async () => ({ id: "new", status, customer_total_inc_gst: 700 }), FIXES_ACCEPT_LATEST: "The owner must accept the newest electrical fixes quote before the fixes can be booked." }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, getStage: async () => "rectification_scheduling", logEvent: async () => {}, paymentGateActiveForJob: async () => true, commercialBlocker: async () => null, paymentGate: async () => ({ cleared: true }) }));
const { fixesPaymentBlockerFor } = await import("../src/lib/payments.server");
test("newest unaccepted quote blocks every caller despite older money/acceptance", async () => { expect(await fixesPaymentBlockerFor("job")).toContain("accept the newest"); });
test("newest accepted quote without invoice cannot count as paid", async () => { status = "accepted"; expect(await fixesPaymentBlockerFor("job")).toContain("invoice not available"); });