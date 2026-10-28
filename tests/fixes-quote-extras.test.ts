// Jo 28 Oct 2026 (final review Imp 2): extra items staff add, once priced by the electrician business owner or the
// office, go on the homeowner's fixes quote as EXTRA lines on top of the repair total, and the electrician is paid for
// them (their price is in quote_internals.cost_ex_gst, which the trade Money page `fixesPay` and the office Payouts read).
// No form tick is ever priced twice: items that came from the Mitti form (source "mitti" / external_key) are not added —
// the repair total already covers the form. Unpriced extras still block the send.
// Run on its own (bun shares mock.module across files in one process): bun test tests/fixes-quote-extras.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_INCLUDED_LABEL, FIXES_PRICE_LABEL, FIXES_WORK_LABEL } from "../src/lib/official-short.core";
import { RECTIFICATION_MARGIN_INC_GST } from "../src/lib/rectification-pricing.core";

type Row = Record<string, any>;
let snapshot: { label: string; value: string | null }[] = [];
let electricalCards: Row[] = [];
let rectItems: Row[] = [];
let inserts: { table: string; row: any }[] = [];
let updates: { table: string; patch: any }[] = [];
let events: { type: string; details: any }[] = [];
let jobChannel: string | null = null;
// Decision 349: the installer's saved usual electrician (admin_config_events) and the assigned electrician business.
let usualCfg: Row | null = null;
let elecBiz: Row | null = null;
// Decision 351: the A1 job's recorded electrician choice (electrician_choice_set), null = none recorded.
let choiceEvent: Row | null = null;

mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let update: any = null; let insert: any = null;
  const q: any = {
    select() { return q; }, eq() { return q; }, contains() { return q; }, is() { return q; }, in() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; },
    update(p: any) { update = p; updates.push({ table, patch: p }); return q; },
    insert(r: any) { insert = r; inserts.push({ table, row: r }); return q; },
    upsert(r: any) { insert = r; inserts.push({ table, row: r }); return q; },
    single() { return Promise.resolve(result(true)); }, maybeSingle() { return Promise.resolve(result(true)); },
    then(a: any, b: any) { return Promise.resolve(result(false)).then(a, b); },
  };
  function result(one: boolean) {
    if (update) return { data: null, error: null };
    if (insert) return { data: table === "quotes" ? { id: "new-quote" } : null, error: null };
    if (table === "jobs") return { data: { channel: jobChannel, originating_installer_business_id: "inst-1" }, error: null };
    if (table === "workflow_events") return { data: choiceEvent, error: null };
    if (table === "pricing_settings") return { data: { id: "ps", version: 3, gst_rate: 0.1 }, error: null };
    if (table === "job_assignments") return { data: { business_id: "rec-1" }, error: null };
    if (table === "assessments") return { data: { mitti_raw_snapshot: snapshot }, error: null };
    if (table === "rate_cards") return { data: one ? electricalCards[0] ?? null : electricalCards, error: null };
    if (table === "rectification_items") return { data: rectItems, error: null };
    if (table === "admin_config_events") return { data: usualCfg, error: null };
    if (table === "businesses") return { data: elecBiz, error: null };
    if (table === "partner_workers") return { data: [], error: null };
    if (table === "workflow_settings") return { data: { auto_send_quote: true, customer_comms_enabled: true }, error: null };
    return { data: null, error: null };
  }
  return q;
} } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (_j: string, _a: string, type: string, _s: string, details: any) => { events.push({ type, details }); },
}));
const { generateRectificationQuote } = await import("../src/lib/quotes.server");

const a4 = (price: string | null, included: string | null) => [
  { label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" },
  { label: FIXES_PRICE_LABEL, value: price },
  { label: FIXES_INCLUDED_LABEL, value: included },
];
const card = { id: "card-1", version: 2, rate_card_items: [{ code: "CALLOUT", description: "Call-out", unit: "flat", unit_price_ex_gst: 100 }, { code: "RCD_INSTALL", description: "Install RCD", unit: "each", unit_price_ex_gst: 200 }] };
const of = (t: string) => inserts.filter((i) => i.table === t).map((i) => i.row);

const { buildA4FixesQuote, pricedFixesExtras } = await import("../src/lib/fixes-price.core");

const priced = (description: string, unit: number, quantity = 1, extra: Row = {}) => ({ id: `it-${description}`, rate_code: null, description, quantity, is_other: true, status: "required", explanation: `Staff: ${description}`, needs_office_pricing: false, other_unit_price_inc_gst: unit, source: null, external_key: null, ...extra });

beforeEach(() => { choiceEvent = null; usualCfg = null; elecBiz = null; jobChannel = null; snapshot = []; electricalCards = [card]; rectItems = []; inserts = []; updates = []; events = []; });

describe("pure", () => {
  test("only priced, staff-added Other items count; form items and unpriced items never do", () => {
    const items = [
      priced("Extra power point", 120),
      priced("From the form", 300, 1, { source: "mitti", external_key: "mitti:a3:1" }),
      priced("Keyed form item", 300, 1, { external_key: "mitti:a3:2" }),
      priced("Waiting for a price", 0, 1, { needs_office_pricing: true, other_unit_price_inc_gst: null }),
      priced("Zero", 0),
      priced("Removed", 50, 1, { status: "removed" }),
      { ...priced("Rate card item", 99), is_other: false },
    ];
    expect(pricedFixesExtras(items).map((e) => e.description)).toEqual(["Extra power point"]);
  });
  test("repair $800 + extra $120 (installer's own electrician, no margin) → two lines, subtotal $920, electrician paid $920", () => {
    const q = buildA4FixesQuote({ electricianPriceIncGst: 800, included: "Install 1 RCD safety switch", gstRate: 0.1, margin: 0, extras: pricedFixesExtras([priced("Extra power point", 120)]) });
    expect(q.lines.map((l) => [l.description, l.line_total_inc_gst, l.is_other])).toEqual([["Electrical repair work", 800, false], ["Extra power point", 120, true]]);
    expect(q.subtotalIncGst).toBe(920);
    expect(Math.round(q.costExGst * 1.1 * 100) / 100).toBe(920);
  });
  test("with our electrician the $100 stays on the repair line only; the extra shows at its own price", () => {
    const q = buildA4FixesQuote({ electricianPriceIncGst: 800, included: "x", gstRate: 0.1, extras: pricedFixesExtras([priced("Extra power point", 60, 2)]) });
    expect(q.lines.map((l) => [l.line_total_inc_gst, l.quantity, l.unit_price_inc_gst])).toEqual([[900, 1, 900], [120, 2, 60]]);
    expect(q.subtotalIncGst).toBe(1020);
    expect(Math.round(q.costExGst * 1.1 * 100) / 100).toBe(920);
  });
});

describe("generateRectificationQuote (electrician-priced path)", () => {
  test("repair total $800 + priced extra $120 → both lines, subtotal includes both, electrician cost includes $120", async () => {
    jobChannel = "installer_sourced";
    usualCfg = { id: "cfg-1", details: { business_id: "inst-1", electrician: { name: "Sparkie Co", licence: "REC 12345", priceIncGst: 220 } } };
    elecBiz = { id: "rec-1", name: "Sparkie Co", trading_name: null, rec_number: "REC-12345" };
    snapshot = a4("800", "Install 1 RCD safety switch");
    rectItems = [priced("Extra power point", 120), priced("From the form", 300, 1, { source: "mitti", external_key: "mitti:a3:1" })];
    await generateRectificationQuote("job", "actor");
    const [quote] = of("quotes");
    const [items] = of("quote_items");
    expect(items.map((l: any) => [l.description, l.line_total_inc_gst])).toEqual([["Electrical repair work", 800], ["Extra power point", 120]]);
    expect(quote).toMatchObject({ subtotal_inc_gst: 920, customer_total_inc_gst: 920 });
    const [internals] = of("quote_internals");
    // Electrician pay = cost_ex_gst inc GST (trade-view `fixesPay`, office Payouts): $920, so the $120 is paid.
    expect(Math.round(internals.cost_ex_gst * 1.1 * 100) / 100).toBe(920);
    expect(internals.calc_snapshot).toMatchObject({ electrician_price_inc_gst: 800, extras_inc_gst: 120 });
  });
  test("our electrician: repair $800 + $100 margin + extra $120 → $1,020", async () => {
    snapshot = a4("800", "Install 1 RCD safety switch");
    rectItems = [priced("Extra power point", 120)];
    await generateRectificationQuote("job", "actor");
    expect(of("quotes")[0].subtotal_inc_gst).toBe(800 + RECTIFICATION_MARGIN_INC_GST + 120);
    expect(Math.round(of("quote_internals")[0].cost_ex_gst * 1.1 * 100) / 100).toBe(920);
  });
  test("no extras → unchanged single line", async () => {
    snapshot = a4("800", "Install 1 RCD safety switch");
    await generateRectificationQuote("job", "actor");
    expect(of("quote_items")[0]).toHaveLength(1);
  });
});
