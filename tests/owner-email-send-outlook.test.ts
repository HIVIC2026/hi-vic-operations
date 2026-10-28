// The REAL guarded owner sender with the Outlook transport (fetch mocked, in-memory tables): every guard still applies,
// the reservation is once-only, a qa_test job reaches ONLY the test address (new message, never the customer's thread),
// and the default Resend path is untouched.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let updateThrows = false;
let tables: Record<string, Row[]> = {};
let n = 0;
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select", payload: Row = {}, one = false, head = false;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (op === "insert") {
      if (table === "customer_email_sends" && rows().some((r) => r["idempotency_key"] === payload["idempotency_key"])) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      const row = { id: `${table}${++n}`, status: "sending", ...payload };
      rows().push(row);
      return { data: { id: row.id }, error: null };
    }
    const hit = rows().filter((r) => f.every((x) => x(r)));
    if (op === "update") { for (const r of hit) Object.assign(r, payload); return { data: one ? (hit[0] ? { id: hit[0]["id"] } : null) : hit, error: null }; }
    if (head) return { count: hit.length, data: null, error: null };
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    in: () => b,
    single: () => { one = true; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => {
  const b = from(t) as Record<string, any>;
  const upd = b["update"];
  b["update"] = (p: Row) => { if (updateThrows && t === "customer_email_sends" && p["provider"] === "outlook") throw new Error("db down"); return upd(p); };
  return b;
} } }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://example.test/u/1" }));
const resendCalls: string[] = [];
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async (to: string) => { resendCalls.push(to); return { outcome: "accepted", id: "re_1", detail: "Accepted" }; } }));
process.env["LOVABLE_API_KEY"] = "lk"; process.env["MICROSOFT_OUTLOOK_API_KEY"] = "mk";

const { sendGuardedOwnerEmail } = await import("../src/lib/owner-email-send.server");
const { QA_INBOX } = await import("../src/lib/qa-inbox.core");

let fetched: { method: string; url: string; body: any }[] = [];
let sendStatus = 202, failCreateReply = false, sendThrows = false;
const realFetch = globalThis.fetch;
beforeEach(() => {
  tables = { outlook_sync_state: [{ id: 1, expected_mailbox: "info@example.com" }], jobs: [{ id: "J", source: "website" }, { id: "Q", source: "qa_test" }] };
  n = 0; fetched = []; sendStatus = 202; failCreateReply = false; sendThrows = false; updateThrows = false; resendCalls.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const u = String(url);
    fetched.push({ method: String(init.method), url: u, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith("/createReply") && failCreateReply) return new Response(null, { status: 400 });
    if (u.endsWith("/send") && sendThrows) throw new Error("timed out");
    if (u.endsWith("/createReply")) return new Response(JSON.stringify({ id: "D1", internetMessageId: "<m@x>" }), { status: 201 });
    if (u.endsWith("/messages") ) return new Response(JSON.stringify({ id: "N1", internetMessageId: "<n@x>" }), { status: 201 });
    if (u.endsWith("/send")) return new Response(null, { status: sendStatus });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

const OUT = { kind: "outlook" as const, replyToMessageId: "AAMk=orig" };
const send = (o: { jobId?: string; transport?: typeof OUT; onSent?: (r: any) => void; key?: string; retry?: boolean } = {}) => sendGuardedOwnerEmail({
  jobId: o.jobId ?? "J", jobSource: "website", to: "owner@example.com", purpose: "owner_reply", key: o.key ?? "k1",
  build: () => ({ subject: "s", html: "<p>h</p>", text: "t" }), ...(o.transport ? { transport: o.transport } : {}), ...(o.onSent ? { onSent: o.onSent } : {}), ...(o.retry ? { retryAfterDefiniteFailure: true } : {}),
});

describe("guarded send, Outlook transport", () => {
  test("sends through Outlook, records provider/id, reports ids through onSent, never touches Resend", async () => {
    let got: unknown;
    expect(await send({ transport: OUT, onSent: (r) => { got = r; } })).toBe("sent");
    expect(got).toEqual({ provider: "outlook", messageId: "D1", internetMessageId: "<m@x>" });
    expect(tables["customer_email_sends"]![0]).toMatchObject({ status: "sent", provider: "outlook", provider_message_id: "D1", error: null });
    expect(fetched.map((c) => c.method)).toEqual(["POST", "PATCH", "POST"]);
    expect(resendCalls).toEqual([]);
  });
  test("an opted-out job is blocked with no Outlook call and no reservation", async () => {
    tables["customer_email_optouts"] = [{ job_id: "J", opted_out_at: "2026-10-01" }];
    expect(await send({ transport: OUT })).toBe("blocked — not sent");
    expect(fetched).toEqual([]);
    expect(tables["customer_email_sends"] ?? []).toEqual([]);
  });
  test("a second call with the same key is not resent", async () => {
    expect(await send({ transport: OUT })).toBe("sent");
    const before = fetched.length;
    expect(await send({ transport: OUT })).toBe("already attempted — not resent");
    expect(fetched).toHaveLength(before);
  });
  test("a definite refusal (4xx on send) is failed, and retryAfterDefiniteFailure then really sends", async () => {
    sendStatus = 400;
    expect(await send({ transport: OUT })).toBe("failed: Outlook couldn't send it");
    expect(tables["customer_email_sends"]![0]).toMatchObject({ status: "failed", provider: "outlook" });
    sendStatus = 202;
    expect(await send({ transport: OUT, retry: true })).toBe("sent");
    expect(tables["customer_email_sends"]![0]).toMatchObject({ status: "sent" });
  });
  test("failure before send (createReply refused) is definite and retryable", async () => {
    failCreateReply = true;
    expect(await send({ transport: OUT })).toBe("failed: Outlook couldn't send it");
    failCreateReply = false;
    expect(await send({ transport: OUT, retry: true })).toBe("sent");
  });
  test("send 5xx or timeout is uncertain: recorded delivered_unrecorded and never resent, even with retry", async () => {
    sendThrows = true;
    expect(await send({ transport: OUT })).toBe("delivery uncertain — not retried");
    expect(tables["customer_email_sends"]![0]).toMatchObject({ status: "delivered_unrecorded", provider: "outlook" });
    const before = fetched.length;
    sendThrows = false;
    expect(await send({ transport: OUT, retry: true })).toBe("already attempted — not resent");
    expect(fetched).toHaveLength(before);
    expect(fetched.some((c) => c.method === "DELETE")).toBe(false);
  });
  test("if the record update throws after a successful send, the result is still sent and onSent fires", async () => {
    updateThrows = true;
    let got: unknown;
    const spy = console.error; console.error = () => {};
    try { expect(await send({ transport: OUT, onSent: (r) => { got = r; } })).toBe("sent"); } finally { console.error = spy; updateThrows = false; }
    expect(got).toMatchObject({ provider: "outlook", messageId: "D1" });
  });
  test("R1: a qa_test job reaches ONLY the test address, as a new message, marked TEST", async () => {
    process.env["HIVIC_COM04_TEST_RECIPIENTS"] = QA_INBOX; // the test inbox is the one address the non-production boundary allows
    try { expect(await send({ jobId: "Q", transport: OUT })).toBe("sent"); } finally { delete process.env["HIVIC_COM04_TEST_RECIPIENTS"]; }
    expect(fetched.some((c) => c.url.includes("/createReply"))).toBe(false);
    const create = fetched.find((c) => c.method === "POST" && c.url.endsWith("/messages"))!;
    expect(create.body.toRecipients).toEqual([{ emailAddress: { address: QA_INBOX } }]);
    expect(create.body.subject).toBe("[TEST] s");
    expect(JSON.stringify(fetched.map((c) => c.body))).not.toContain("owner@example.com");
  });
  test("default transport is still Resend", async () => {
    let got: unknown;
    expect(await send({ onSent: (r) => { got = r; } })).toBe("sent");
    expect(resendCalls).toEqual(["owner@example.com"]);
    expect(fetched).toEqual([]);
    expect(got).toEqual({ provider: "resend", messageId: "re_1", internetMessageId: null });
  });
});
