import { expect, mock, test } from "bun:test";
import { withQaContext } from "../src/lib/qa-context.server";
const rows: Record<string, unknown>[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null }; } }) } }));
const { sendTestEmail, sendTestSms } = await import("../src/lib/test-send.server");
test("browser TEST context blocks even sending-allowlisted recipients before provider", async () => {
  let calls = 0; const previous = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; throw new Error("forbidden"); }) as typeof fetch;
  try {
    const ctx = { jobId: "test", jobSource: "qa_test", partnerIsTest: true, label: "QA no sends", actorId: null };
    const email = await withQaContext(true, () => sendTestEmail(ctx, "jolowexo@hotmail.com", "test", "test", "test"));
    const sms = await withQaContext(true, () => sendTestSms(ctx, "0400000000", "test"));
    expect(email.status).toBe("blocked"); expect(sms.status).toBe("blocked"); expect(calls).toBe(0);
    expect(rows.filter(r => r.delivery_status === "blocked_prelaunch").length).toBe(2);
  } finally { globalThis.fetch = previous; }
});