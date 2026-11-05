// Task 6 (recovery paths): a quote whose lines don't add up to its totals (or can't be read) is held, never released.
import { beforeEach, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let failReads = new Set<string>();
let failUpdates = new Set<string>();
let writes: { table: string; patch: Row }[] = [];
let events: { type: string; details: any; internal?: boolean }[] = [];
let notifications = 0;

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" = "select", patch: Row = {}, one = false;
  const run = () => {
    const rows = (tables[table] ??= []);
    if (op === "update") {
      if (failUpdates.has(table)) return { data: null, error: { message: `${table} write failed` } };
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, patch);
      writes.push({ table, patch });
      return { data: one ? hit[0] ?? null : hit, error: null };
    }
    if (failReads.has(table)) return { data: null, error: { message: `${table} read failed` } };
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b, update: (p: Row) => { op = "update"; patch = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    order: () => b, limit: () => b, single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: any, opts?: any) => { events.push({ type, details, internal: opts?.internal }); },
  commercialBlocker: async () => null, stageEntryBlockers: async () => [], transition: async () => {},
}));
mock.module("../src/lib/estimatelink.server", () => ({ ensureOwnerLink: async () => true }));
mock.module("../src/lib/installer-intake.server", () => ({ intakeSendBlockers: async () => [] }));
mock.module("../src/lib/installer-quote.server", () => ({ quoteBillingBlocker: async () => null }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/pilot.server", () => ({ applyCobrand: async () => {} }));
mock.module("../src/lib/install-evidence.server", () => ({ jobProductProblems: async () => [] }));
mock.module("../src/lib/upgrades-billing.core", () => ({ UPGRADES_QUOTE_SEND_BLOCKER: "x", electricianBillsUpgrades: () => false }));
mock.module("../src/lib/allocation.core", () => ({ rectificationSendBlocker: () => null }));
mock.module("../src/lib/rectification.server", () => ({ fixesTimesHoldFor: async () => null }));
mock.module("../src/lib/quote-ready-notify.server", () => ({ notifyOwnerQuoteReady: async () => { notifications++; return { email: "ok", sms: "ok" }; } }));
const { sendOfficeReviewedQuote } = await import("../src/lib/office-quote-review.server");
const { releaseFixesQuote } = await import("../src/lib/fixes-quote-release.server");
const { quoteTotalsHoldReason, holdForTotals } = await import("../src/lib/quote-totals.server");

const mismatchEvents = () => events.filter((e) => e.type === "quote_totals_mismatch");
beforeEach(() => {
  failReads = new Set(); failUpdates = new Set(); writes = []; events = []; notifications = 0;
  tables = {
    quotes: [{ id: "q", job_id: "j", kind: "installation", status: "draft", release_state: "held", release_hold_reason: "Waiting for office review before sending", sent_at: null, option_code: "R5_BATTS", created_at: "2026-10-23T00:00:00Z", office_reviewed_at: null, subtotal_inc_gst: 3000, veec_discount_inc_gst: 1470, customer_total_inc_gst: 1530 }],
    quote_items: [{ quote_id: "q", line_total_inc_gst: 2000 }, { quote_id: "q", line_total_inc_gst: 1000 }],
    jobs: [{ id: "j", stage: "measured_estimate_ready", source: "website", deleted_at: null, qa_archived_at: null, channel: "installer_sourced" }],
    ceiling_measurements: [], workflow_events: [], rectification_items: [],
  };
});
const sent = () => tables["quotes"]![0]!["sent_at"];

test("send_holds_on_mismatch (office Send): lines that don't add up are held, not sent", async () => {
  tables["quote_items"]![0]!["line_total_inc_gst"] = 2200; // lines 3200, subtotal 3000
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow(/totals don't add up/);
  expect(sent()).toBeNull();
  expect(tables["quotes"]![0]).toMatchObject({ status: "draft", release_state: "held", release_hold_reason: "Quote totals don't add up" });
  expect(notifications).toBe(0);
  expect(mismatchEvents()).toHaveLength(1);
  expect(mismatchEvents()[0]!.details).toMatchObject({ quote_id: "q", needs_office: true });
  expect(mismatchEvents()[0]!.details.reason).toMatch(/3200\.00/);
  expect(mismatchEvents()[0]!.internal).toBe(true);
});

test("office Send: owner price that isn't subtotal minus rebate is held too", async () => {
  tables["quotes"]![0]!["customer_total_inc_gst"] = 0;
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow(/totals don't add up/);
  expect(sent()).toBeNull();
});

test("office Send: a failed lines read holds it with the same reason and never sends", async () => {
  failReads.add("quote_items");
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow(/totals don't add up/);
  expect(sent()).toBeNull();
  expect(tables["quotes"]![0]!["release_hold_reason"]).toBe("Quote totals don't add up");
  expect(mismatchEvents()[0]!.details.reason).toMatch(/could not be read/);
});

test("office Send: matching totals still send", async () => {
  await sendOfficeReviewedQuote("j", "q", "office");
  expect(sent()).not.toBeNull();
  expect(tables["quotes"]![0]).toMatchObject({ status: "issued", release_state: "released" });
  expect(notifications).toBe(1);
  expect(mismatchEvents()).toHaveLength(0);
});

test("send_holds_on_mismatch (auto send uses the same release): held, nothing sent", async () => {
  const { releaseQuoteToOwner } = await import("../src/lib/office-quote-review.server");
  tables["quote_items"]![1]!["line_total_inc_gst"] = 900;
  await expect(releaseQuoteToOwner("j", "q", null, "auto")).rejects.toThrow(/totals don't add up/);
  expect(sent()).toBeNull();
  expect(mismatchEvents()).toHaveLength(1);
});

test("send_holds_on_mismatch (fixes release): held, not issued", async () => {
  Object.assign(tables["quotes"]![0]!, { kind: "rectification" });
  tables["quote_items"]![0]!["line_total_inc_gst"] = 2200;
  await expect(releaseFixesQuote("q", "actor", "auto")).rejects.toThrow(/totals don't add up/);
  expect(tables["quotes"]![0]).toMatchObject({ status: "draft", sent_at: null, release_state: "held", release_hold_reason: "Quote totals don't add up" });
  expect(mismatchEvents()).toHaveLength(1);
});

test("fixes release: matching totals are issued, and a failed read holds", async () => {
  Object.assign(tables["quotes"]![0]!, { kind: "rectification" });
  failReads.add("quote_items");
  await expect(releaseFixesQuote("q", "actor", "auto")).rejects.toThrow(/totals don't add up/);
  expect(sent()).toBeNull();
  failReads.clear();
  await releaseFixesQuote("q", "actor", "auto");
  expect(tables["quotes"]![0]).toMatchObject({ status: "issued" });
  expect(sent()).not.toBeNull();
});

test("quoteTotalsHoldReason: a failed quote read is a reason; holdForTotals only touches draft/issued quotes", async () => {
  failReads.add("quotes");
  expect(await quoteTotalsHoldReason("q")).toMatch(/could not be read/);
  failReads.clear();
  expect(await quoteTotalsHoldReason("q")).toBeNull();
  tables["quotes"]![0]!["status"] = "accepted";
  expect(await holdForTotals("q", "j", "why")).toBe(false);
  expect(tables["quotes"]![0]!["status"]).toBe("accepted");
});

test("holdForTotals: 0 rows held returns false and logs nothing (an issued quote is not un-sent)", async () => {
  tables["quotes"]![0]!["status"] = "issued"; tables["quotes"]![0]!["sent_at"] = "2026-11-01T00:00:00Z";
  expect(await holdForTotals("q", "j", "why")).toBe(false);
  expect(tables["quotes"]![0]).toMatchObject({ status: "issued", sent_at: "2026-11-01T00:00:00Z" });
  expect(mismatchEvents()).toHaveLength(0);
});

test("holdForTotals: a write error throws and logs nothing; office Send and fixes release never release then", async () => {
  failUpdates.add("quotes");
  await expect(holdForTotals("q", "j", "why")).rejects.toThrow(/could not be held/);
  expect(mismatchEvents()).toHaveLength(0);
  tables["quote_items"]![0]!["line_total_inc_gst"] = 2200;
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow(/could not be held/);
  Object.assign(tables["quotes"]![0]!, { kind: "rectification" });
  await expect(releaseFixesQuote("q", "actor", "auto")).rejects.toThrow(/could not be held/);
  expect(sent()).toBeNull();
  expect(notifications).toBe(0);
});

test("office Send: a mismatched quote that is no longer a draft is refused, not released, and nothing is logged", async () => {
  tables["quotes"]![0]!["status"] = "issued"; // quoteNeedsOfficeReview still true (issued, unsent, not released)
  tables["quote_items"]![0]!["line_total_inc_gst"] = 2200;
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow(/nothing was sent/);
  expect(sent()).toBeNull();
  expect(mismatchEvents()).toHaveLength(0);
});
