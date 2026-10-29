// Mitti instant-notice public route: token check, body check, always 200 once the token is good. Handler is stubbed;
// runAfterResponse is stubbed to hold the background task so the test decides when it runs.
// Run alone: bun test tests/mitti-audit-route.test.ts
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

let handlerCalls: string[];
let handlerResult: { action: string } | Error;
let handlerGate: Promise<void> | null = null;
mock.module("@/lib/mitti-webhook.server", () => ({
  handleMittiNotice: async (id: string) => {
    handlerCalls.push(id);
    if (handlerGate) await handlerGate;
    if (handlerResult instanceof Error) throw handlerResult;
    return handlerResult;
  },
}));
let tasks: (() => Promise<unknown>)[];
mock.module("@/lib/background.server", () => ({
  requestContext: { getStore: () => undefined },
  runAfterResponse: (task: () => Promise<unknown>) => { tasks.push(task); return "wait_until"; },
}));
/** Runs every queued background task; a task that throws fails the test (the route must catch inside it). */
const drain = async () => { for (const t of tasks.splice(0)) await t(); };

const { Route } = await import("../src/routes/api/public/hooks/mitti-audit");
const post = (Route as unknown as { options: { server: { handlers: { POST: (x: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
const call = (query: string, body: string) => post({ request: new Request(`http://x/api/public/hooks/mitti-audit${query}`, { method: "POST", body }) });
const good = JSON.stringify({ event: "audit.updated", data: { audit_id: "aud_123" } });

const saved = process.env["MITTI_WEBHOOK_TOKEN"];
beforeEach(() => { handlerCalls = []; handlerResult = { action: "synced" }; handlerGate = null; tasks = []; process.env["MITTI_WEBHOOK_TOKEN"] = "secret-token"; });
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
  test("good ?t, body without audit id → 200, handler not called, warns with the key names only", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const r = await call("?t=secret-token", JSON.stringify({ event: "audit.updated", payload: { id: "aud_secret_value" }, owner_email: "helen@example.com" }));
    expect(r.status).toBe(200);
    expect(handlerCalls).toEqual([]);
    expect(tasks).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("mitti notice: no audit id", ["event", "payload", "owner_email"]);
    const logged = JSON.stringify(warn.mock.calls);
    for (const value of ["audit.updated", "aud_secret_value", "helen@example.com"]) expect(logged).not.toContain(value);
    warn.mockRestore();
  });
  test("good ?t, body not JSON → 200, warns 'not json'", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect((await call("?t=secret-token", "audit_id=aud_123&owner=Helen")).status).toBe(200);
    expect(warn).toHaveBeenCalledWith("mitti notice: no audit id", "not json");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Helen");
    expect(handlerCalls).toEqual([]);
    warn.mockRestore();
  });
  test("bad token never logs the body shape", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await call("?t=nope", JSON.stringify({ event: "audit.updated" }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  test("good ?t, valid body → 200 before the handler runs, then the handler is called once with the id", async () => {
    const r = await call("?t=secret-token", good);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(handlerCalls).toEqual([]); // answered first
    expect(tasks).toHaveLength(1);
    await drain();
    expect(handlerCalls).toEqual(["aud_123"]);
  });
  test("200 is returned while the handler is still running", async () => {
    let release!: () => void;
    handlerGate = new Promise<void>((res) => { release = res; });
    const r = await call("?t=secret-token", good);
    expect(r.status).toBe(200);
    const running = drain();
    for (let i = 0; i < 100 && handlerCalls.length === 0; i++) await new Promise((res) => setTimeout(res, 1));
    let finished = false;
    void running.then(() => { finished = true; });
    await new Promise((res) => setTimeout(res, 5));
    expect(handlerCalls).toEqual(["aud_123"]); // started
    expect(finished).toBe(false); // ...and still running after the 200
    release();
    await running;
    expect(handlerCalls).toEqual(["aud_123"]);
  });
  test("good ?t, handler returns failed → still 200", async () => {
    handlerResult = { action: "failed" };
    expect((await call("?t=secret-token", good)).status).toBe(200);
    await drain();
  });
  test("handler throws → still 200; the error is logged with the audit id and message, not thrown", async () => {
    handlerResult = new Error("db down");
    const err = spyOn(console, "error").mockImplementation(() => {});
    const r = await call("?t=secret-token", good);
    expect(r.status).toBe(200);
    await drain(); // must not reject
    expect(err).toHaveBeenCalledWith("mitti notice: handler failed", "aud_123", "db down");
    err.mockRestore();
  });
  test("aborted body → 200, nothing runs", async () => {
    const body = new ReadableStream({ pull(c) { c.error(new Error("aborted")); } });
    const req = new Request("http://x/api/public/hooks/mitti-audit?t=secret-token", { method: "POST", body, duplex: "half" } as RequestInit);
    const r = await post({ request: req });
    expect(r.status).toBe(200);
    expect(tasks).toEqual([]);
    expect(handlerCalls).toEqual([]);
  });
});

describe("Settings switch", () => {
  test("Mitti instant updates is an office column right after Mitti pick-up", async () => {
    const { OFFICE_SWITCH_COLUMNS, SWITCHES } = await import("../src/lib/office-settings.core");
    expect(OFFICE_SWITCH_COLUMNS).toContain("mitti_instant_notice_enabled");
    const i = SWITCHES.findIndex((s) => s.key === "mitti_pickup");
    expect(SWITCHES[i + 1]).toMatchObject({ key: "mitti_instant", label: "Mitti instant updates", kind: "column", column: "mitti_instant_notice_enabled" });
  });
  test("before its migration the switch reads 'waiting for the database change', off and not editable", async () => {
    const { PENDING_SWITCH_COLUMNS, SWITCHES, switchState } = await import("../src/lib/office-settings.core");
    expect(PENDING_SWITCH_COLUMNS.mitti_instant_notice_enabled).toBe("docs/pending-migrations/mitti-instant-notice-switch.sql");
    const def = SWITCHES.find((s) => s.key === "mitti_instant")!;
    expect(def).toMatchObject({ pendingMigration: "docs/pending-migrations/mitti-instant-notice-switch.sql" });
    expect(switchState(def, { customer_comms_enabled: false })).toMatchObject({ on: false, editable: false, note: expect.stringContaining("mitti-instant-notice-switch.sql") });
    expect(switchState(def, { mitti_instant_notice_enabled: true })).toMatchObject({ on: true, editable: true });
  });
});
