import { expect, mock, test } from "bun:test";
const writes: Record<string, unknown>[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ insert: async (row: Record<string, unknown>) => { writes.push(row); return { error: null }; } }) } }));
mock.module("../src/lib/qa-inbox.server", () => ({ qaDeliveryHeld: async () => true, qaInboxRouteForJob: async () => null }));
let calls = 0;
mock.module("../src/lib/twilio-au1.server", () => ({ au1SendMessage: async () => { calls++; throw new Error("No delivery"); } }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async () => { calls++; throw new Error("No delivery"); } }));
globalThis.fetch = (async () => { calls++; throw new Error("No delivery"); }) as typeof fetch;
const sender = await import("../src/lib/test-send.server");
const owner = await import("../src/lib/owner-email-send.server");
test("run-owned no-delivery hold stops email and SMS even to the normally allowed TEST inbox", async () => {
  const c = { jobId: "held", jobSource: "qa_test", partnerIsTest: true, label: "TEST", actorId: null };
  expect((await sender.sendTestEmail(c, "jolowexo@hotmail.com", "TEST", "TEST", "TEST")).status).toBe("blocked");
  expect((await sender.sendTestSms(c, "0477511901", "TEST")).status).toBe("blocked");
  expect(await owner.sendGuardedOwnerEmail({ jobId: "held", jobSource: "qa_test", to: "jolowexo@hotmail.com", purpose: "TEST", key: "TEST", build: () => ({ subject: "TEST", html: "TEST", text: "TEST" }) })).toContain("blocked");
  expect(calls).toBe(0);
  expect(writes.filter(x => x.delivery_status === "blocked_prelaunch")).toHaveLength(2);
});