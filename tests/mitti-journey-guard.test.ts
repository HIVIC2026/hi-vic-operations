import { afterEach, expect, mock, test } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({}) } }));
const ms = await import("../src/lib/mitti.server");
afterEach(() => ms.disarmJourneyMittiGuard());

// Jo 27 Oct: a TEST journey never reaches real Mitti.
test("armed guard sends product Mitti calls to the simulator, not the network", async () => {
  let fetched = 0; const real = globalThis.fetch; globalThis.fetch = (async () => { fetched++; return new Response("{}"); }) as never;
  try {
    const g = ms.armJourneyMittiGuard(async () => ({ audit_id: "sim" }));
    expect(await ms.realMittiCall("POST", "/audits", {})).toEqual({ audit_id: "sim" });
    expect(g.routed).toEqual(["POST /audits"]); expect(fetched).toBe(0);
  } finally { globalThis.fetch = real; }
});
test("armed guard without a simulator refuses loudly", async () => {
  ms.armJourneyMittiGuard(null);
  await expect(ms.realMittiCall("GET", "/audits/x")).rejects.toThrow("SAFETY STOP");
  await expect(ms.realMittiMedia("a", "m")).rejects.toThrow("SAFETY STOP");
});
