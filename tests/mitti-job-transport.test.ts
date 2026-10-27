import { expect, mock, test } from "bun:test";
let source = "qa_test", failRead = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: failRead ? null : { source }, error: failRead ? new Error("offline") : null }) }) }) }) } }));
const simulated: unknown[][] = [];
mock.module("../src/lib/mitti-simulated.server", () => ({ simulatedJobMitti: async () => async (...args: unknown[]) => { simulated.push(args); return { audit_id: "sim-only" }; } }));
const { mittiCallForJob, realMittiCall } = await import("../src/lib/mitti.server");
test("actual job transport sends qa_test creation to simulator with zero provider calls", async () => {
  source = "qa_test";
  let count = 0; const previous = globalThis.fetch;
  globalThis.fetch = (async () => { count++; throw new Error("provider forbidden"); }) as typeof fetch;
  try {
    expect(await (await mittiCallForJob("job"))("POST", "/audits", { template_id: "t" })).toEqual({ audit_id: "sim-only" });
    expect(count).toBe(0); expect(simulated.length).toBe(1);
  } finally { globalThis.fetch = previous; }
});
test("real job sends the identical method, path, body and token to existing real endpoint", async () => {
  source = "base44"; const previous = globalThis.fetch, oldToken = process.env.MITTI_API_TOKEN;
  process.env.MITTI_API_TOKEN = "unit-test-token";
  let observed: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = (async (url, init) => { observed = { url: String(url), init }; return new Response('{"audit_id":"real"}'); }) as typeof fetch;
  try {
    const body = { template_id: "same-template" };
    expect(await (await mittiCallForJob("job"))("POST", "/audits", body)).toEqual({ audit_id: "real" });
    const request = observed as { url: string; init?: RequestInit } | null;
    expect(request?.url).toBe("https://api.mitti.com/audits"); expect(request?.init?.method).toBe("POST"); expect(request?.init?.body).toBe(JSON.stringify(body));
    expect(new Headers(request?.init?.headers).get("Authorization")).toBe("Bearer unit-test-token");
  } finally { globalThis.fetch = previous; if (oldToken === undefined) delete process.env.MITTI_API_TOKEN; else process.env.MITTI_API_TOKEN = oldToken; }
});
test("unknown job refuses instead of selecting real transport", async () => {
  failRead = true;
  await expect(mittiCallForJob("missing", realMittiCall)).rejects.toThrow("SAFETY STOP");
  failRead = false;
});