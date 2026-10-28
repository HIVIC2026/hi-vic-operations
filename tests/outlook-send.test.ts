// Outlook transport (Graph via the connector gateway) with fetch mocked: reply path order + headers, 404 fallback to a new
// message, send failure, and the read-only permission check. No network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 1, expected_mailbox: "info@example.com" }, error: null }) }) }) }) },
}));
process.env["LOVABLE_API_KEY"] = "lk"; process.env["MICROSOFT_OUTLOOK_API_KEY"] = "mk";
const { sendViaOutlook, outlookSendAllowed } = await import("../src/lib/outlook-send.server");

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let script: (c: Call) => { status: number; json?: unknown };
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const c: Call = { method: String(init.method), url: String(url).replace("https://connector-gateway.lovable.dev/microsoft_outlook", ""), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = script(c);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status });
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });
const P = { replyToMessageId: "AAMk=orig", to: "owner@example.com", subject: "Re: roof", html: "<p>hi</p>" };
const MB = "/users/info%40example.com";

describe("sendViaOutlook", () => {
  test("reply: createReply -> PATCH -> send, in order, ImmutableId, only the owner addressed", async () => {
    script = (c) => c.url.endsWith("/createReply") ? { status: 201, json: { id: "D1", internetMessageId: "<m@x>" } } : { status: c.method === "PATCH" ? 200 : 202 };
    const r = await sendViaOutlook(P);
    expect(r).toEqual({ outcome: "sent", messageId: "D1", internetMessageId: "<m@x>" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${MB}/messages/AAMk%3Dorig/createReply`, `PATCH ${MB}/messages/D1`, `POST ${MB}/messages/D1/send`]);
    expect(calls.every((c) => c.headers["Prefer"] === 'IdType="ImmutableId"' && c.headers["Authorization"] === "Bearer lk" && c.headers["X-Connection-Api-Key"] === "mk")).toBe(true);
    expect(calls[1]!.body).toEqual({ subject: "Re: roof", body: { contentType: "HTML", content: "<p>hi</p>" }, toRecipients: [{ emailAddress: { address: "owner@example.com" } }] });
  });
  test("createReply 404 falls back to a new message", async () => {
    script = (c) => c.url.endsWith("/createReply") ? { status: 404 } : c.url.endsWith("/send") ? { status: 202 } : { status: 201, json: { id: "N1", internetMessageId: "<n@x>" } };
    const r = await sendViaOutlook(P);
    expect(r).toEqual({ outcome: "sent", messageId: "N1", internetMessageId: "<n@x>" });
    expect(calls.map((c) => `${c.method} ${c.url.replace(MB, "")}`)).toEqual(["POST /messages/AAMk%3Dorig/createReply", "POST /messages", "POST /messages/N1/send"]);
  });
  test("no original id goes straight to a new message", async () => {
    script = (c) => c.url.endsWith("/send") ? { status: 202 } : { status: 201, json: { id: "N2" } };
    expect(await sendViaOutlook({ ...P, replyToMessageId: null })).toEqual({ outcome: "sent", messageId: "N2", internetMessageId: null });
    expect(calls).toHaveLength(2);
  });
  test("send 5xx is UNCERTAIN and the draft is NOT deleted", async () => {
    script = (c) => c.url.endsWith("/createReply") ? { status: 201, json: { id: "D1" } } : c.url.endsWith("/send") ? { status: 503 } : { status: 200 };
    const r = await sendViaOutlook(P);
    expect(r).toMatchObject({ outcome: "uncertain", messageId: "D1" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
  test("send timeout is UNCERTAIN and the draft is NOT deleted", async () => {
    script = (c) => { if (c.url.endsWith("/send")) throw new Error("timed out"); return c.url.endsWith("/createReply") ? { status: 201, json: { id: "D1" } } : { status: 200 }; };
    expect(await sendViaOutlook(P)).toMatchObject({ outcome: "uncertain", messageId: "D1" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
  test("send 4xx is a definite failure and the draft is cleaned up", async () => {
    script = (c) => c.url.endsWith("/createReply") ? { status: 201, json: { id: "D1" } } : c.url.endsWith("/send") ? { status: 400 } : { status: 200 };
    expect((await sendViaOutlook(P)).outcome).toBe("failed");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });
  test("a network error never throws", async () => {
    script = () => { throw new Error("boom"); };
    expect(await sendViaOutlook(P)).toEqual({ outcome: "failed", detail: "boom" });
  });
});

describe("outlookSendAllowed", () => {
  test("403 means read-only", async () => {
    script = () => ({ status: 403 });
    expect(await outlookSendAllowed()).toEqual({ ok: false, detail: "Outlook is connected for reading only. Reconnect it in Lovable to allow sending." });
  });
  test("ok creates then deletes a draft, sends nothing", async () => {
    script = (c) => c.method === "POST" ? { status: 201, json: { id: "T1" } } : { status: 204 };
    expect(await outlookSendAllowed()).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.url.replace(MB, "")}`)).toEqual(["POST /messages", "DELETE /messages/T1"]);
  });
});
