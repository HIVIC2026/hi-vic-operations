// Decision 305 (Jo 25 Oct 2026): generateRectificationQuote builds the owner's fixes quote from the electrician's A4 total
// (one line + the decision-142 margin), keeps the rate-card path for older forms, and the quote stays a held draft.
import { beforeEach, expect, mock, test } from "bun:test";
import { FIXES_INCLUDED_LABEL, FIXES_PRICE_LABEL } from "../src/lib/official-short.core";
import { RECTIFICATION_MARGIN_INC_GST } from "../src/lib/rectification-pricing.core";

type Row = Record<string, any>;
let snapshot: { label: string; value: string | null }[] = [];
let electricalCards: Row[] = [];
let rectItems: Row[] = [];
let inserts: { table: string; row: any }[] = [];
let updates: { table: string; patch: any }[] = [];
let events: { type: string; details: any }[] = [];

mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let update: any = null; let insert: any = null;
  const q: any = {
    select() { return q; }, eq() { return q; }, is() { return q; }, in() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; },
    update(p: any) { update = p; updates.push({ table, patch: p }); return q; },
    insert(r: any) { insert = r; inserts.push({ table, row: r }); return q; },
    single() { return Promise.resolve(result(true)); }, maybeSingle() { return Promise.resolve(result(true)); },
    then(a: any, b: any) { return Promise.resolve(result(false)).then(a, b); },
  };
  function result(one: boolean) {
    if (update) return { data: null, error: null };
    if (insert) return { data: table === "quotes" ? { id: "new-quote" } : null, error: null };
    if (table === "pricing_settings") return { data: { id: "ps", version: 3, gst_rate: 0.1 }, error: null };
    if (table === "job_assignments") return { data: { business_id: "rec-1" }, error: null };
    if (table === "assessments") return { data: { mitti_raw_snapshot: snapshot }, error: null };
    if (table === "rate_cards") return { data: one ? electricalCards[0] ?? null : electricalCards, error: null };
    if (table === "rectification_items") return { data: rectItems, error: null };
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

beforeEach(() => { snapshot = []; electricalCards = [card]; rectItems = []; inserts = []; updates = []; events = []; });

test("A4 price + included → ONE 'Electrical repair work' line at electrician price + margin; cost = price ex GST", async () => {
  snapshot = a4("$1,100.00", "Replace 6 downlights with IC-4 LEDs, install 1 RCD");
  expect(await generateRectificationQuote("job", "actor")).toBe("new-quote");
  const [quote] = of("quotes");
  expect(quote).toMatchObject({ kind: "rectification", status: "draft", rate_card_id: "card-1", subtotal_inc_gst: 1100 + RECTIFICATION_MARGIN_INC_GST, customer_total_inc_gst: 1100 + RECTIFICATION_MARGIN_INC_GST, veec_discount_inc_gst: 0 });
  const [items] = of("quote_items");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ quote_id: "new-quote", description: "Electrical repair work", explanation: "Replace 6 downlights with IC-4 LEDs, install 1 RCD", quantity: 1, line_total_inc_gst: 1200 });
  const [internals] = of("quote_internals");
  expect(internals).toMatchObject({ quote_id: "new-quote", cost_ex_gst: 1000, calc_snapshot: { pricing_source: "a4_piesa_electrician_total", electrician_price_inc_gst: 1100, rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST } });
  // Release rules unchanged: still a held draft for office review, nothing released even with every switch on.
  const release = updates.find((u) => u.table === "quotes" && "release_state" in u.patch)!.patch;
  expect(release).toMatchObject({ status: "draft", release_state: "held", sent_at: null, release_hold_reason: "Waiting for office review before sending" });
  expect(events.map((e) => e.type)).toEqual(["rectification_quote_held"]);
});

test("no rate card needed on the A4 path (rate_card_id stays null)", async () => {
  snapshot = a4("900", "Install 1 RCD");
  electricalCards = [];
  await generateRectificationQuote("job", "actor");
  expect(of("quotes")[0].rate_card_id).toBeNull();
  expect(of("quote_items")[0][0].line_total_inc_gst).toBe(1000);
});

test("older form without the price keeps the rate-card path (and still needs the card and the items)", async () => {
  snapshot = a4(null, null);
  rectItems = [{ rate_code: "RCD_INSTALL", description: "Install RCD", quantity: 1, is_other: false, explanation: null, needs_office_pricing: false, other_unit_price_inc_gst: null }];
  await generateRectificationQuote("job", "actor");
  const [items] = of("quote_items");
  expect(items.map((l: any) => l.code)).toEqual(["CALLOUT", "RCD_INSTALL"]);
  expect(of("quote_internals")[0].calc_snapshot.pricing_source).toBeUndefined();
  electricalCards = []; inserts = [];
  await expect(generateRectificationQuote("job", "actor")).rejects.toThrow(/rate card/);
  expect(of("quotes")).toHaveLength(0);
});

test("a price with no description falls back to the rate-card path", async () => {
  snapshot = a4("900", null);
  rectItems = [];
  await expect(generateRectificationQuote("job", "actor")).rejects.toThrow(/No electrical fixes items/);
});
