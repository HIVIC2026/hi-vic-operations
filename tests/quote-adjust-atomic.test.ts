// Task 6 (recovery paths): a quote edit is validated whole in memory, saved by ONE RPC, and never leaves new lines with an old total.
import { beforeEach, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let writes: { table: string; op: string; patch?: Row }[] = [];
let failReads: Set<string> = new Set();
let failWrites: Set<string> = new Set();
let rpcCalls: { fn: string; args: any }[] = [];
let rpcResult: { data: any; error: any } = { data: { ok: true }, error: null };
let events: { type: string; details: any; internal?: boolean }[] = [];
let intake = false;
let readyCheck = false;
const U = "11111111-1111-4111-8111-111111111111";

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "insert" = "select", patch: Row = {}, one = false, cols = "*";
  const run = () => {
    const rows = (tables[table] ??= []);
    if (op === "update") {
      if (failWrites.has(table)) return { data: null, error: { message: `${table} write failed` } };
      writes.push({ table, op, patch });
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, patch);
      return { data: one ? hit[0] ?? null : hit, error: null };
    }
    if (op === "insert") {
      if (failWrites.has(table)) return { data: null, error: { message: `${table} write failed` } };
      writes.push({ table, op, patch });
      rows.push(patch);
      return { data: null, error: null };
    }
    if (failReads.has(table)) return { data: null, error: { message: `${table} read failed` } };
    let hit = rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
    if (table === "quotes" && cols.includes("quote_items(*)")) hit = hit.map((r) => ({ ...r, quote_items: (tables["quote_items"] ?? []).filter((i) => i.quote_id === r.id).map((i) => ({ ...i })) }));
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, unknown> = {
    select: (c?: string) => { if (op === "select") cols = c ?? "*"; return b; },
    update: (p: Row) => { op = "update"; patch = p; return b; },
    insert: (p: Row) => { op = "insert"; patch = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; }, limit: () => b,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
const admin = { from: builder, rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcResult; } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: any, opts?: any) => { events.push({ type, details, internal: opts?.internal }); },
}));
mock.module("../src/lib/installer-quote-status.server", () => ({ loadInstallerQuote: async () => ({ applies: readyCheck }) }));
mock.module("../src/lib/installer-intake.server", () => ({ isIntakeJob: async () => intake }));
const { adjustQuote } = await import("../src/lib/quotes.server");

const itemsOf = () => (tables["quote_items"] ?? []).map((i) => i.line_total_inc_gst);
const changes = (price: number) => [{ id: "i1", quantity: 1, unit_price_inc_gst: price }];

beforeEach(() => {
  writes = []; failReads = new Set(); failWrites = new Set(); rpcCalls = []; events = []; intake = false; readyCheck = false;
  rpcResult = { data: { ok: true }, error: null };
  tables = {
    quotes: [{ id: "q1", job_id: "j1", status: "issued", option_code: "R5", version: 4, pricing_settings_id: "ps1", subtotal_inc_gst: 3000, gst_amount: 272.73, veec_discount_inc_gst: 1470, customer_total_inc_gst: 1530, manually_adjusted: false }],
    quote_items: [{ id: "i1", quote_id: "q1", quantity: 1, unit_price_inc_gst: 2000, line_total_inc_gst: 2000, sort: 0 }, { id: "i2", quote_id: "q1", quantity: 1, unit_price_inc_gst: 1000, line_total_inc_gst: 1000, sort: 1 }],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200 }],
    pricing_settings: [{ id: "ps1", gst_rate: 0.1 }], quote_adjustments: [],
  };
});

test("rejected_discount_saves_nothing: $3,000 to $3,200 with a rebate that is not allowed leaves the lines alone", async () => {
  await expect(adjustQuote("q1", U, "price up", changes(2200), 1500)).rejects.toThrow();
  expect(itemsOf()).toEqual([2000, 1000]);
  expect(writes).toEqual([]);
  expect(rpcCalls).toEqual([]);
  expect(events).toEqual([]);
});

test("item_read_timeout_no_zero: the lines come from the one quote read, so a failing items read can't make the total $0", async () => {
  failReads.add("quote_items");
  rpcResult = { data: { ok: true }, error: null };
  await adjustQuote("q1", U, "price up", changes(2200), 1470);
  expect(rpcCalls).toHaveLength(1);
  expect(rpcCalls[0]!.args.p_totals).toMatchObject({ subtotal_inc_gst: 3200, customer_total_inc_gst: 1730 });
  expect(writes).toEqual([]);
});

test("a failed quote read stops the edit and writes nothing", async () => {
  failReads.add("quotes");
  await expect(adjustQuote("q1", U, "price up", changes(2200), 1470)).rejects.toThrow();
  expect(writes).toEqual([]);
  expect(rpcCalls).toEqual([]);
});

test("a failed settings or GST read stops the edit and writes nothing", async () => {
  for (const t of ["retail_estimator_settings", "pricing_settings"]) {
    failReads = new Set([t]);
    await expect(adjustQuote("q1", U, "price up", changes(2200), 1470)).rejects.toThrow();
  }
  expect(writes).toEqual([]);
  expect(rpcCalls).toEqual([]);
});

test("one RPC carries the lines, totals, release and the before snapshot; events come after", async () => {
  await adjustQuote("q1", U, "price up", changes(2200), 1470);
  expect(rpcCalls).toHaveLength(1);
  const a = rpcCalls[0]!.args;
  expect(rpcCalls[0]!.fn).toBe("apply_quote_adjustment");
  expect(a).toMatchObject({ p_quote_id: "q1", p_expected_version: 4, p_release: null });
  expect(a.p_items).toEqual([{ id: "i1", quantity: 1, unit_price_inc_gst: 2200, line_total_inc_gst: 2200 }]);
  expect(a.p_totals).toMatchObject({ subtotal_inc_gst: 3200, veec_discount_inc_gst: 1470, customer_total_inc_gst: 1730, manually_adjusted: true });
  expect(a.p_adjustment).toMatchObject({ adjusted_by: U, reason: "price up" });
  expect(a.p_adjustment.before_snapshot.version).toBe(4);
  expect(writes).toEqual([]); // nothing but the RPC wrote
  expect(events.map((e) => e.type)).toEqual(["quote_adjusted"]);
  expect(events[0]!.details).toMatchObject({ before_total: 1530, after_total: 1730 });
});

test("draft quote goes to held in the same RPC (same reasons as before)", async () => {
  tables["quotes"]![0]!["status"] = "draft";
  await adjustQuote("q1", U, "price up", changes(2200), 1470);
  expect(rpcCalls[0]!.args.p_release).toEqual({ release_state: "held", release_hold_reason: "Quote held: manually priced or adjusted" });
  readyCheck = true; rpcCalls = [];
  await adjustQuote("q1", U, "price up", changes(2200), 1470);
  expect(rpcCalls[0]!.args.p_release.release_hold_reason).toBe("Waiting for office review before sending");
});

test("an issued installer intake quote goes back to a held draft in the same RPC", async () => {
  tables["quotes"]![0]!["option_code"] = "INSTALLER_A1"; intake = true;
  await adjustQuote("q1", U, "price up", changes(2200), 1470);
  expect(rpcCalls[0]!.args.p_release).toEqual({ status: "draft", release_state: "held", release_hold_reason: "Adjusted after sending — office must re-approve", sent_at: null });
});

test("version_conflict_message: someone else changed the quote", async () => {
  rpcResult = { data: null, error: { code: "P0001", message: "version_conflict" } };
  await expect(adjustQuote("q1", U, "price up", changes(2200), 1470)).rejects.toThrow("This quote was changed by someone else – reload");
  expect(events).toEqual([]);
});

test("another RPC error is thrown and no events are logged", async () => {
  rpcResult = { data: null, error: { code: "XX000", message: "boom" } };
  await expect(adjustQuote("q1", U, "price up", changes(2200), 1470)).rejects.toThrow("boom");
  expect(events).toEqual([]);
});

test("RPC not deployed: validates first, then the old sequence with every write checked", async () => {
  rpcResult = { data: null, error: { code: "PGRST202", message: "function not found" } };
  const log = console.error; const errs: string[] = []; console.error = (m: string) => { errs.push(String(m)); };
  try {
    await adjustQuote("q1", U, "price up", changes(2200), 1470);
  } finally { console.error = log; }
  expect(errs.join(" ")).toMatch(/apply_quote_adjustment.*not deployed/);
  expect(itemsOf()).toEqual([2200, 1000]);
  expect(tables["quotes"]![0]).toMatchObject({ subtotal_inc_gst: 3200, customer_total_inc_gst: 1730, version: 5 });
  expect(tables["quote_adjustments"]).toHaveLength(1);
  expect((tables["quote_adjustments"]![0] as any).after_snapshot.customer_total_inc_gst).toBe(1730);
  expect(events.map((e) => e.type)).toEqual(["quote_adjusted"]);
});

test("RPC not deployed: a rejected discount still writes nothing, and a failed write is thrown", async () => {
  rpcResult = { data: null, error: { code: "42883", message: "no function" } };
  const log = console.error; console.error = () => {};
  try {
    await expect(adjustQuote("q1", U, "price up", changes(2200), 1500)).rejects.toThrow();
    expect(writes).toEqual([]);
    failWrites.add("quote_items");
    await expect(adjustQuote("q1", U, "price up", changes(2200), 1470)).rejects.toThrow("quote_items write failed");
    expect(events).toEqual([]);
  } finally { console.error = log; }
});
