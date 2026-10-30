import { beforeEach, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { memoryPostgrest } from "./helpers/memory-postgrest";

// @tanstack/react-router is not needed to exercise the handler: createFileRoute just hands the options back.
mock.module("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
const tables: Record<string, any[]> = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: memoryPostgrest(tables) }));
const key = Buffer.from("hook-test-key");
process.env["RESEND_WEBHOOK_SECRET"] = `whsec_${key.toString("base64")}`;
const { Route } = await import("../src/routes/api/public/hooks/resend-delivery");
const POST = (Route as any).options.server.handlers.POST as (a: { request: Request }) => Promise<Response>;

function req(evt: unknown, signed = true) {
  const raw = JSON.stringify(evt);
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signed) {
    headers["svix-id"] = "msg_1"; headers["svix-timestamp"] = String(ts);
    headers["svix-signature"] = `v1,${createHmac("sha256", key).update(`msg_1.${ts}.${raw}`).digest("base64")}`;
  }
  return { request: new Request("http://x/api/public/hooks/resend-delivery", { method: "POST", body: raw, headers }) };
}
const bounce = { type: "email.bounced", data: { email_id: "em_1", bounce: { message: "550 User unknown" } } };

beforeEach(() => {
  tables["customer_email_sends"] = [{ id: "s1", provider_message_id: "em_1", delivery_result: null, delivery_detail: null, delivery_at: null }, { id: "s2", provider_message_id: "em_9", delivery_result: null }];
  tables["job_communications"] = [{ id: "c1", provider_message_id: "em_2", delivery_result: null }];
});

test("unsigned request is 401 and changes nothing", async () => {
  expect((await POST(req(bounce, false))).status).toBe(401);
  expect(tables["customer_email_sends"]![0].delivery_result).toBeNull();
});
test("missing secret is 401", async () => {
  const s = process.env["RESEND_WEBHOOK_SECRET"]; delete process.env["RESEND_WEBHOOK_SECRET"];
  try { expect((await POST(req(bounce))).status).toBe(401); } finally { process.env["RESEND_WEBHOOK_SECRET"] = s; }
});
test("signed bounce updates exactly one row; a repeat changes nothing more", async () => {
  expect((await POST(req(bounce))).status).toBe(200);
  const row = tables["customer_email_sends"]![0];
  expect(row.delivery_result).toBe("bounced");
  expect(row.delivery_detail).toBe("Email address doesn't exist");
  expect(row.delivery_at).toBeTruthy();
  expect(tables["customer_email_sends"]![1].delivery_result).toBeNull();
  const first = row.delivery_at;
  expect((await POST(req(bounce))).status).toBe(200);
  expect(tables["customer_email_sends"]![0].delivery_at).toBe(first);
});
test("job_communications rows are updated too", async () => {
  expect((await POST(req({ type: "email.delivered", data: { email_id: "em_2" } }))).status).toBe(200);
  expect(tables["job_communications"]![0].delivery_result).toBe("delivered");
});
test("unknown id and ignored types are 200 with no change", async () => {
  expect((await POST(req({ type: "email.bounced", data: { email_id: "nope" } }))).status).toBe(200);
  expect((await POST(req({ type: "email.opened", data: { email_id: "em_1" } }))).status).toBe(200);
  expect(tables["customer_email_sends"]!.every((r) => r.delivery_result == null)).toBe(true);
});
test("a late delivered never overwrites bounced", async () => {
  await POST(req(bounce));
  await POST(req({ type: "email.delivered", data: { email_id: "em_1" } }));
  expect(tables["customer_email_sends"]![0].delivery_result).toBe("bounced");
});
