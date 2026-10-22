import { beforeEach, expect, mock, test } from "bun:test";

type Row = { id: string; stage: string; owner_phone: string; office_bucket: string; source: string; deleted_at: string | null; cancelled_reason?: string; prior_stage?: string };
let rows: Row[] = [], optouts: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [], failOptout = false, failClose = false;
const client = { from(table: string) {
  const filters: Array<(r: any) => boolean> = [];
  let payload: any, operation = "read", start = 0, end = 499;
  const result = () => {
    if (table === "sms_optouts" && operation === "upsert") {
      if (failOptout) return { data: null, error: { message: "isolated failure" } };
      optouts.push(payload); return { data: null, error: null };
    }
    if (table === "workflow_events") { events.push(payload); return { data: null, error: null }; }
    if (table === "sms_messages" || table === "job_communications") return { data: null, error: null };
    let selected = rows.filter(r => filters.every(f => f(r)));
    if (operation === "update") {
      if (failClose) return { data: null, error: { message: "isolated failure" } };
      for (const row of selected) { Object.assign(row, payload); row.office_bucket = "closed"; }
    }
    return { data: selected.slice(start, end + 1).map(r => ({ ...r })), error: null };
  };
  const q: any = {
    select: () => q, eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
    neq: (k: string, v: any) => { filters.push(r => r[k] !== v); return q; },
    is: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
    not: () => q, order: () => q, limit: () => q,
    range: (a: number, b: number) => { start = a; end = b; return q; },
    upsert: (v: any) => { payload = v; operation = "upsert"; return q; },
    update: (v: any) => { payload = v; operation = "update"; return q; },
    insert: (v: any) => { payload = v; operation = "insert"; return q; },
    maybeSingle: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
} };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: () => { throw new Error("No outbound calls allowed"); }, hasCurrentOwnerContactConsent: () => false }));
const { recordInboundReply } = await import("../src/lib/sms.server");
const enquiry = (id = "open"): Row => ({ id, stage: "preliminary_estimate_ready", owner_phone: "0491 234 567", office_bucket: "enquiry", source: "base44", deleted_at: null });
beforeEach(() => { rows = [enquiry()]; optouts = []; events = []; failOptout = false; failClose = false; });
test("actual STOP handler records opt-out and closes the open enquiry with Jo's exact reason", async () => {
  await recordInboundReply("+61491234567", "STOP", "isolated-stop");
  expect(optouts[0]?.phone).toBe("+61491234567");
  expect(rows[0]?.stage).toBe("cancelled"); expect(rows[0]?.cancelled_reason).toBe("Opted out (replied STOP)");
  expect(rows[0]?.prior_stage).toBe("preliminary_estimate_ready");
  expect(events).toHaveLength(1); expect(events[0]?.from_stage).toBe("preliminary_estimate_ready");
});
test("STOP closes all same-phone open enquiries but not other homeowners, TEST, deleted, saved or progressed work", async () => {
  rows = [enquiry(), enquiry("second"), { ...enquiry("other"), owner_phone: "0491234568" }, { ...enquiry("test"), source: "qa_test" }, { ...enquiry("deleted"), deleted_at: "2026-10-22" }, { ...enquiry("saved"), office_bucket: "active" }, { ...enquiry("booked"), stage: "ready_check_scheduled", office_bucket: "active" }];
  await recordInboundReply("0491234567", "STOP");
  expect(rows.filter(r => r.stage === "cancelled").map(r => r.id)).toEqual(["open", "second"]);
  expect(events).toHaveLength(2);
});
test("repeated STOP does not duplicate closure or stage history", async () => {
  await recordInboundReply("0491234567", "STOP", "same"); await recordInboundReply("0491234567", "STOP", "same");
  expect(events).toHaveLength(1); expect(rows[0]?.prior_stage).toBe("preliminary_estimate_ready");
});
test("START and ordinary replies never close or reopen enquiries", async () => {
  await recordInboundReply("0491234567", "START"); await recordInboundReply("0491234567", "Thanks");
  expect(rows[0]?.stage).toBe("preliminary_estimate_ready"); expect(events).toHaveLength(0);
  rows[0] = { ...enquiry(), stage: "cancelled", office_bucket: "closed" };
  await recordInboundReply("0491234567", "START"); expect(rows[0]?.stage).toBe("cancelled");
});
test("failed opt-out persistence cannot close an enquiry", async () => {
  failOptout = true; await expect(recordInboundReply("0491234567", "STOP")).rejects.toThrow("Could not record SMS opt-out");
  expect(rows[0]?.stage).toBe("preliminary_estimate_ready"); expect(events).toHaveLength(0);
});
test("failed closure is surfaced rather than acknowledging success", async () => {
  failClose = true; await expect(recordInboundReply("0491234567", "STOP")).rejects.toThrow("Could not close enquiry after STOP");
  expect(optouts).toHaveLength(1); expect(rows[0]?.stage).toBe("preliminary_estimate_ready");
});