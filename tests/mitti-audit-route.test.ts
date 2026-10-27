// Mitti instant-notice public route: token check, body check, always 200 once the token is good. Handler is stubbed.
// Run alone: bun test tests/mitti-audit-route.test.ts
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

let handlerCalls: string[];
let handlerResult: { action: string } | Error;
mock.module("@/lib/mitti-webhook.server", () => ({
  handleMittiNotice: async (id: string) => { handlerCalls.push(id); if (handlerResult instanceof Error) throw handlerResult; return handlerResult; },
}));

const { Route } = await import("../src/routes/api/public/hooks/mitti-audit");
const post = (Route as unknown as { options: { server: { handlers: { POST: (x: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
const call = (query: string, body: string) => post({ request: new Request(`http://x/api/public/hooks/mitti-audit${query}`, { method: "POST", body }) });
const good = JSON.stringify({ event: "audit.updated", data: { audit_id: "aud_123" } });

const saved = process.env["MITTI_WEBHOOK_TOKEN"];
beforeEach(() => { handlerCalls = []; handlerResult = { action: "synced" }; process.env["MITTI_WEBHOOK_TOKEN"] = "secret-token"; });
afterEach(() => { if (saved === undefined) delete process.env["MITTI_WEBHOOK_TOKEN"]; else process.env["MITTI_WEBHOOK_TOKEN"] = saved; });

describe("mitti-audit route", () => {
  test("no ?t → 403, handler not called", async () => {
    expect((await call("", good)).status).toBe(403);
    expect(handlerCalls).toEqual([]);
  });
  test("wrong ?t → 403, handler not called", async () => {
    expect((await call("?t=nope", good)).status).toBe(403);
    expect(handlerCalls).toEqual([]);
  });
  test("token not configured → 403", async () => {
    delete process.env["MITTI_WEBHOOK_TOKEN"];
    expect((await call("?t=secret-token", good)).status).toBe(403);
    expect(handlerCalls).toEqual([]);
  });
  test("good ?t, body without audit id → 200, handler not called", async () => {
    const r = await call("?t=secret-token", JSON.stringify({ event: "audit.updated" }));
    expect(r.status).toBe(200);
    expect(handlerCalls).toEqual([]);
  });
  test("good ?t, valid body → 200, handler called once with the id", async () => {
    const r = await call("?t=secret-token", good);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(handlerCalls).toEqual(["aud_123"]);
  });
  test("good ?t, handler returns failed → still 200", async () => {
    handlerResult = { action: "failed" };
    expect((await call("?t=secret-token", good)).status).toBe(200);
  });
  test("handler throws → still 200, logs a message with no body or owner details", async () => {
    handlerResult = new Error("db down");
    const err = spyOn(console, "error").mockImplementation(() => {});
    const r = await call("?t=secret-token", good);
    expect(r.status).toBe(200);
    expect(err).toHaveBeenCalledWith("mitti notice: handler failed", "db down");
    err.mockRestore();
  });
});

describe("Settings switch", () => {
  test("Mitti instant updates is an office column right after Mitti pick-up", async () => {
    const { OFFICE_SWITCH_COLUMNS, SWITCHES } = await import("../src/lib/office-settings.core");
    expect(OFFICE_SWITCH_COLUMNS).toContain("mitti_instant_notice_enabled");
    const i = SWITCHES.findIndex((s) => s.key === "mitti_pickup");
    expect(SWITCHES[i + 1]).toMatchObject({ key: "mitti_instant", label: "Mitti instant updates", kind: "column", column: "mitti_instant_notice_enabled" });
  });
});
