import { describe, it, expect, mock, beforeEach } from "bun:test";
let ran = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: async () => ({ data: false }) } }));
mock.module("@/lib/external-action-outbox.server", () => ({ processExternalActionOutbox: async () => { ran++; return { ok: true }; } }));
const { Route } = await import("../src/routes/api/public/hooks/external-actions");
const post = (Route as any).options.server.handlers.POST;
const call = (h: Record<string, string>) => post({ request: new Request("http://x/api/public/hooks/external-actions", { method: "POST", headers: h }) });
describe("external-actions cron auth", () => {
  beforeEach(() => { ran = 0; process.env.LOVABLE_CRON_SECRET = "right-secret"; delete process.env.LOVABLE_CRON_SECRET_PREVIOUS; });
  it("correct secret runs the queue", async () => { const r = await call({ authorization: "Bearer right-secret" }); expect(r.status).toBe(200); expect(ran).toBe(1); });
  it("missing secret is refused", async () => { const r = await call({}); expect(r.status).toBe(401); expect(ran).toBe(0); });
  it("wrong secret is refused", async () => { const r = await call({ authorization: "Bearer wrong" }); expect(r.status).toBe(401); expect(ran).toBe(0); });
  it("invalid one-time code is refused", async () => { const r = await call({ "x-hivic-cron-nonce": "bad" }); expect(r.status).toBe(403); expect(ran).toBe(0); });
});
