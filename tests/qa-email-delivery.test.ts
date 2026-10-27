import { expect, mock, test } from "bun:test";
let source = "qa_test", master = true;
const rows: Record<string, unknown>[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: table === "jobs" ? { source } : { customer_comms_enabled: master }, error: null }), insert: async (r: Record<string, unknown>) => { rows.push(r); return { error: null }; } };
  return q;
} } }));
const submitted: Record<string, unknown>[] = [];
globalThis.fetch = (async (_input, init) => {
  submitted.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ id: "mock-only-email-id" }), { status: 200 });
}) as typeof fetch;
process.env["RESEND_API_KEY"] = "mock-only";
process.env["LOVABLE_API_KEY"] = "mock-only";
const { sendTestEmail, sendTestSms } = await import("../src/lib/test-send.server");
const ctx = { jobId: "TEST", jobSource: "qa_test", partnerIsTest: false, label: "mock-only-proof", actorId: null, emailApproved: true };
test("approved persisted TEST job emails only Jo and retains original-recipient marker", async () => {
  expect((await sendTestEmail(ctx, "trade@hivic-test.example", "Subject", "<body>Original</body>", "Original")).status).toBe("sent");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ to: ["jolowexo@hotmail.com"], subject: "[TEST] Subject", text: "TEST — would have gone to: trade@hivic-test.example\n\nOriginal" });
});
test("master OFF and approval OFF refuse TEST email without provider submission", async () => {
  master = false;
  expect((await sendTestEmail(ctx, "owner@hivic-test.example", "s", "h", "t")).detail).toContain("customer_comms_enabled");
  master = true;
  expect((await sendTestEmail({ ...ctx, emailApproved: false }, "owner@hivic-test.example", "s", "h", "t")).status).toBe("blocked");
  expect(submitted).toHaveLength(1);
});
test("claimed TEST source cannot send for a persisted real job", async () => {
  source = "base44";
  expect((await sendTestEmail(ctx, "owner@hivic-test.example", "s", "h", "t")).status).toBe("blocked");
  expect(submitted).toHaveLength(1);
});
test("even Jo's allowlisted mobile receives no TEST SMS", async () => {
  expect((await sendTestSms(ctx, "+61477511901", "t")).status).toBe("blocked");
  expect(submitted).toHaveLength(1);
});