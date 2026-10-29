// Batch 2, item 4 (Jo 29 Oct 2026): a declined quote that the office reopens and sends again must reach the owner —
// first sends keep their old keys; after the n-th reopen both keys end `:r${n}`; the 7am held-text sweep only re-sends
// the text whose key matches the CURRENT reopen count.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { HELD_KEY_MARK } from "../src/lib/sms.core";
import type { HeldRow } from "../src/lib/quiet-held-texts.core";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
const builder = (t: string) => {
  const f: ((r: Row) => boolean)[] = [];
  let one = false;
  const b: Record<string, unknown> = {
    select: () => b, limit: () => b, order: () => b,
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    contains: (c: string, v: Record<string, unknown>) => { f.push((r) => Object.entries(v).every(([k, x]) => (r[c] as Row | null)?.[k] === x)); return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r))); return Promise.resolve({ data: one ? out[0] ?? null : out, error: null }).then(res, rej); },
  };
  return b;
};
// Copies of the real exports (mock.module patches the live module in place), put back in afterAll so the mocks
// don't leak into later files in the same run.
const realClient = { ...(await import("@/integrations/supabase/client.server")) };
const realComms = { ...(await import("../src/lib/comms.server")) };
const realWorkflow = { ...(await import("../src/lib/workflow.server")) };
const realSms = { ...(await import("../src/lib/sms.server")) };
const realOwnerEmail = { ...(await import("../src/lib/owner-email-send.server")) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => {} }));
const claimed = new Set<string>();
const smsKeys: string[] = [], emailKeys: string[] = [];
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (i: { idempotencyKey: string }) => {
  smsKeys.push(i.idempotencyKey);
  if (claimed.has(i.idempotencyKey)) return { status: "already", detail: "already sent", sid: null };
  claimed.add(i.idempotencyKey); return { status: "sent", detail: "ok", sid: "SM1" };
} }));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: { key: string }) => {
  emailKeys.push(p.key);
  if (claimed.has(p.key)) return "already sent";
  claimed.add(p.key); return "sent";
} }));
const { notifyOwnerQuoteReady } = await import("../src/lib/quote-ready-notify.server");
afterAll(() => {
  mock.module("@/integrations/supabase/client.server", () => realClient);
  mock.module("../src/lib/comms.server", () => realComms);
  mock.module("../src/lib/workflow.server", () => realWorkflow);
  mock.module("../src/lib/sms.server", () => realSms);
  mock.module("../src/lib/owner-email-send.server", () => realOwnerEmail);
});

const reopen = (quoteId: string) => ({ job_id: "j1", event_type: "quote_reopened_by_office", details: { quote_id: quoteId } });
beforeEach(() => {
  claimed.clear(); smsKeys.length = 0; emailKeys.length = 0;
  tables = {
    jobs: [{ id: "j1", owner_id: "o1", property_id: null, job_number: "HV-1", source: "base44", stage: "awaiting_quote_acceptance", deleted_at: null, qa_archived_at: null }],
    owners: [{ id: "o1", phone: "0412345678", email: "o@example.com", full_name: "Sam Owner" }],
    quotes: [{ id: "q1", job_id: "j1", customer_total_inc_gst: 3000, veec_discount_inc_gst: 0, subtotal_inc_gst: 3000, sent_at: "2026-10-29T01:00:00Z", kind: "installation", status: "issued", release_state: "released" }],
    quote_items: [], properties: [], ceiling_measurements: [], job_assignments: [],
    customer_estimate_links: [{ job_id: "j1", purpose: "step3_estimate", status: "active", token: "tok", expires_at: "2099-01-01T00:00:00Z" }],
    workflow_events: [],
  };
});

describe("quote-ready keys across reopens", () => {
  test("first send keeps the old keys", async () => {
    await notifyOwnerQuoteReady("j1", "q1", "installation");
    expect(smsKeys).toEqual(["quote-ready:v1:q1"]);
    expect(emailKeys).toEqual(["quote-ready-email:v1:q1"]);
  });
  test("after one reopen both keys end :r1 and the text and email are sent again", async () => {
    await notifyOwnerQuoteReady("j1", "q1", "installation");
    tables["workflow_events"] = [reopen("q1")];
    const r = await notifyOwnerQuoteReady("j1", "q1", "installation");
    expect(smsKeys).toEqual(["quote-ready:v1:q1", "quote-ready:v1:q1:r1"]);
    expect(emailKeys).toEqual(["quote-ready-email:v1:q1", "quote-ready-email:v1:q1:r1"]);
    expect(r.sms.startsWith("sent")).toBe(true);
    expect(r.email).toBe("sent");
  });
  test("a second Send with no further reopen is already (no duplicate)", async () => {
    tables["workflow_events"] = [reopen("q1")];
    await notifyOwnerQuoteReady("j1", "q1", "installation");
    const again = await notifyOwnerQuoteReady("j1", "q1", "installation");
    expect(again.sms.startsWith("already")).toBe(true);
    expect(again.email).toBe("already sent");
  });
  test("a second reopen uses :r2; reopens of another quote or job do not count", async () => {
    tables["workflow_events"] = [reopen("q1"), reopen("q1"), reopen("q9"), { ...reopen("q1"), job_id: "j2" }, { job_id: "j1", event_type: "quote_sent_by_office", details: { quote_id: "q1" } }];
    await notifyOwnerQuoteReady("j1", "q1", "installation");
    expect(smsKeys).toEqual(["quote-ready:v1:q1:r2"]);
    expect(emailKeys).toEqual(["quote-ready-email:v1:q1:r2"]);
  });
});

describe("7am sweep only re-sends the current quote-ready key", () => {
  const heldRow = (key: string): HeldRow => ({
    idempotency_key: `${key}${HELD_KEY_MARK}a1`, message_type: "quote_ready", job_id: "j1", business_id: null, to_number: "+61412345678",
    body: "x", status: "blocked", detail: "quiet", created_at: "2026-10-28T11:00:00Z", job: null,
  });
  const still = async (key: string) => (await import("../src/lib/quiet-held-texts.server")).STILL_TRUE.quote_ready(heldRow(key));
  test("never reopened: the original goes", async () => { expect(await still("quote-ready:v1:q1")).toBe(true); });
  test("after a reopen: a held original does not go, the held :r1 does", async () => {
    tables["workflow_events"] = [reopen("q1")];
    expect(await still("quote-ready:v1:q1")).toBe(false);
    expect(await still("quote-ready:v1:q1:r1")).toBe(true);
  });
  test("after a second reopen: a held :r1 does not go, :r2 does", async () => {
    tables["workflow_events"] = [reopen("q1"), reopen("q1")];
    expect(await still("quote-ready:v1:q1:r1")).toBe(false);
    expect(await still("quote-ready:v1:q1:r2")).toBe(true);
  });
  test("an :r1 held text with no reopen on record does not go", async () => { expect(await still("quote-ready:v1:q1:r1")).toBe(false); });
});
