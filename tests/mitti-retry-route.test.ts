// Mitti retry cron route: bearer check first, then one sweep, then JSON counts. Nothing live is touched.
import { beforeEach, describe, expect, mock, test } from "bun:test";

// @tanstack/react-router is not needed to exercise the handler: createFileRoute just hands the options back.
mock.module("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));

let sweepCalls = 0;
mock.module("@/lib/mitti-retry.server", () => ({
  runMittiRetrySweep: async () => { sweepCalls++; return { checked: 3, linked: 1, retried: 1, alerted: 0 }; },
}));

process.env.LOVABLE_CRON_SECRET = "test-cron-secret";
const { Route } = await import("../src/routes/api/public/hooks/mitti-retry");
const POST = (Route as any).options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;
const call = (headers: Record<string, string> = {}) =>
  POST({ request: new Request("http://localhost/api/public/hooks/mitti-retry", { method: "POST", headers }) });

describe("mitti-retry cron route", () => {
  beforeEach(() => { sweepCalls = 0; });
  test("401 without a bearer, sweep not run", async () => {
    expect((await call()).status).toBe(401);
    expect(sweepCalls).toBe(0);
  });
  test("401 with the wrong bearer, sweep not run", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
    expect(sweepCalls).toBe(0);
  });
  test("200 with JSON counts for the right bearer", async () => {
    const res = await call({ authorization: "Bearer test-cron-secret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 3, linked: 1, retried: 1, alerted: 0 });
    expect(sweepCalls).toBe(1);
  });
});
