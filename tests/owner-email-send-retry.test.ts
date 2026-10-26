// Review R04: the REAL guarded owner sender (owner-email-send.server) against an in-memory customer_email_sends with its
// unique idempotency key. Default callers are unchanged (one reservation per key, never resent); a caller that opts in
// to `retryAfterDefiniteFailure` re-claims ONLY a definitely-failed reservation (one winner) and resends with the SAME
// provider idempotency key; an uncertain outcome or a sent email is never resent; a throw before the provider call
// leaves the reservation 'failed' (nothing handed over) instead of 'sending' forever.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let sends: Row[] = [];
let n = 0;
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select", payload: Row = {}, one = false, head = false;
  const run = () => {
    if (table !== "customer_email_sends") return head ? { count: 0, data: null, error: null } : { data: one ? null : [], error: null };
    if (op === "insert") {
      if (sends.some((r) => r["idempotency_key"] === payload["idempotency_key"])) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      const row = { id: `s${++n}`, status: "sending", ...payload };
      sends.push(row);
      return { data: { id: row.id }, error: null };
    }
    const hit = sends.filter((r) => f.every((x) => x(r)));
    if (op === "update") { for (const r of hit) Object.assign(r, payload); return { data: one ? (hit[0] ? { id: hit[0]["id"] } : null) : hit, error: null }; }
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
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
let outcome: "accepted" | "rejected" | "uncertain" | "not_attempted" = "accepted";
const calls: string[] = [];
mock.module("../src/lib/hot-leads-send.server", () => ({
  resendSend: async (_to: string, _s: string, _h: string, _t: string, idem: string) => {
    calls.push(idem);
    return outcome === "accepted" ? { outcome, id: "re_1", detail: "Accepted" } : outcome === "rejected" ? { outcome, status: 422, detail: "Email service error 422: bad" } : outcome === "uncertain" ? { outcome, detail: "No clear answer" } : { outcome, detail: "Email is not connected" };
  },
}));
let unsubThrows = false;
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => { if (unsubThrows) throw new Error("unsubscribe token unavailable"); return "https://example.test/u/1"; } }));

const { sendGuardedOwnerEmail, guardedOwnerEmailStatus } = await import("../src/lib/owner-email-send.server");
const KEY = "warranty-followup:v1:J";
const send = (retry?: boolean) => sendGuardedOwnerEmail({ jobId: "J", jobSource: "website", to: "owner@example.com", purpose: "warranty_followup", key: KEY, build: () => ({ subject: "s", html: "h", text: "t" }), ...(retry ? { retryAfterDefiniteFailure: true } : {}) });
beforeEach(() => { sends = []; n = 0; outcome = "accepted"; calls.length = 0; unsubThrows = false; });

describe("R04: guarded owner sender reservation outcomes", () => {
  test("default callers are unchanged: a failed reservation is never resent", async () => {
    outcome = "rejected";
    expect(await send()).toMatch(/^failed: /);
    outcome = "accepted";
    expect(await send()).toBe("already attempted — not resent");
    expect(calls).toEqual([KEY]);
    expect(await guardedOwnerEmailStatus(KEY)).toBe("failed");
  });
  test("opt-in: a DEFINITE failure is re-claimed once and resent with the same provider key", async () => {
    outcome = "not_attempted";
    expect(await send(true)).toMatch(/^failed: /);
    outcome = "accepted";
    expect(await send(true)).toBe("sent");
    expect(calls).toEqual([KEY, KEY]);
    expect(sends).toHaveLength(1);
    expect(await guardedOwnerEmailStatus(KEY)).toBe("sent");
    expect(await send(true)).toBe("already attempted — not resent"); // sent is final
    expect(calls).toHaveLength(2);
  });
  test("opt-in never resends an UNKNOWN outcome", async () => {
    outcome = "uncertain";
    expect(await send(true)).toBe("delivery uncertain — not retried");
    outcome = "accepted";
    expect(await send(true)).toBe("already attempted — not resent");
    expect(calls).toEqual([KEY]);
    expect(await guardedOwnerEmailStatus(KEY)).toBe("delivered_unrecorded");
  });
  test("a throw before the provider call leaves the reservation 'failed' (nothing handed over), and opt-in retries it", async () => {
    unsubThrows = true;
    await expect(send(true)).rejects.toThrow("unsubscribe token unavailable");
    expect(calls).toEqual([]);
    expect(await guardedOwnerEmailStatus(KEY)).toBe("failed");
    unsubThrows = false;
    expect(await send(true)).toBe("sent");
    expect(calls).toEqual([KEY]);
  });
  test("a sent email keeps no error text; a failed one keeps the reason", async () => {
    expect(await send()).toBe("sent");
    expect(sends[0]).toMatchObject({ status: "sent", error: null, provider_message_id: "re_1" });
    sends = []; outcome = "rejected";
    expect(await send()).toMatch(/^failed: /);
    expect(sends[0]).toMatchObject({ status: "failed", error: "Email service error 422: bad" });
  });
  test("no reservation = null in the email log", async () => {
    expect(await guardedOwnerEmailStatus(KEY)).toBeNull();
  });
});
