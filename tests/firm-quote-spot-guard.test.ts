import { beforeEach, expect, mock, test } from "bun:test";
let liveAt: string | null = null;
let error: { code: string; message: string } | null = null;
let source = "base44";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error,
      data: table === "workflow_settings" ? { firm_quote_flow_live_at: liveAt } : table === "jobs" ? { source, created_at: "2026-11-06T06:00:00Z" } : [{ kind: "intake_media", mime_type: "image/jpeg", storage_path: "owner/photo.jpg" }],
    }).then(resolve) }; return q;
} } }));
const { skipSpotMessage } = await import("../src/lib/firm-quote.server");
beforeEach(() => { liveAt = null; error = null; source = "base44"; });
test("firm quote owner messages share the exact skip reason", async () => {
  liveAt = "2026-11-06T06:00:00Z";
  expect(await skipSpotMessage("job")).toEqual({ status: "skipped", reason: "firm_quote_job" });
});
test("null activation leaves normal owner delivery untouched", async () => { expect(await skipSpotMessage("job")).toBeNull(); });
test("installer jobs stay on their existing path", async () => { liveAt = "2026-11-06T06:00:00Z"; source = "installer_portal"; expect(await skipSpotMessage("job")).toBeNull(); });
test("read failures fail closed rather than permitting a spot message", async () => { error = { code: "42501", message: "denied" }; await expect(skipSpotMessage("job")).rejects.toThrow(); });