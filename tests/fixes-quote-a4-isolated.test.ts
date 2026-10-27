// Decision 305 (Jo 25 Oct 2026): generateRectificationQuote builds the owner's fixes quote from the electrician's A3 total
// (one line + the decision-142 margin), keeps the rate-card path for older forms, and the quote stays a held draft.
import { beforeEach, expect, mock, test } from "bun:test";
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

beforeEach(() => { choiceEvent = null; usualCfg = null; elecBiz = null; jobChannel = null; snapshot = []; electricalCards = [card]; rectItems = []; inserts = []; updates = []; events = []; });

test("A3 price + included → ONE 'Electrical repair work' line at electrician price + margin; cost = price ex GST", async () => {
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

test("no rate card needed on the A3 path (rate_card_id stays null)", async () => {
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

// Decision 308: the ticks (with counts) build the explanation.
const a4Ticks = (price: string) => [
  { label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" },
  { label: FIXES_PRICE_LABEL, value: price },
  { label: FIXES_WORK_LABEL, value: "Replace downlights with IC-4 rated LED downlights, Install RCD safety switches" },
  { label: FIXES_DOWNLIGHT_COUNT_LABEL, value: "6" },
  { label: "How many RCD safety switches are you installing?", value: "1" },
];

test("decision 308: ticked inclusions become the line explanation", async () => {
  snapshot = a4Ticks("1100");
  await generateRectificationQuote("job", "actor");
  expect(of("quote_items")[0][0]).toMatchObject({ explanation: "Replace 6 downlights with IC-4 rated LED downlights; Install 1 RCD safety switch", line_total_inc_gst: 1100 + RECTIFICATION_MARGIN_INC_GST });
});

test("decision 308: a downlight tick without the count falls back to the rate-card path", async () => {
  snapshot = a4Ticks("1100").filter((e) => e.label !== FIXES_DOWNLIGHT_COUNT_LABEL);
  rectItems = [];
  await expect(generateRectificationQuote("job", "actor")).rejects.toThrow(/No electrical fixes items/);
});

// Decision 351 (Jo 25 Oct 2026): the margin follows WHOSE electrician on A1 too (replaces decision 313's channel rule).
const sparkieUsual = { id: "cfg-1", details: { business_id: "inst-1", electrician: { name: "Sparkie Co", licence: "REC 12345", priceIncGst: 220 } } };
test("decision 351: A1 + the installer's usual electrician (the one assigned) → A3 price as is, no $100", async () => {
  jobChannel = "installer_sourced";
  usualCfg = sparkieUsual;
  elecBiz = { id: "rec-1", name: "Sparkie Co", trading_name: null, rec_number: "REC-12345" };
  snapshot = a4Ticks("1100");
  await generateRectificationQuote("job", "actor");
  expect(of("quotes")[0]).toMatchObject({ subtotal_inc_gst: 1100, customer_total_inc_gst: 1100 });
  expect(of("quote_items")[0]).toHaveLength(1);
  expect(of("quote_items")[0][0]).toMatchObject({ unit_price_inc_gst: 1100, line_total_inc_gst: 1100 });
  expect(of("quote_internals")[0]).toMatchObject({ cost_ex_gst: 1000, calc_snapshot: { rectification_margin_inc_gst: 0, electrician_source: "installer_usual" } });
});

test("decision 351: A1 with Home Insulation Victoria's electrician (no usual saved) → electrician price + $100", async () => {
  jobChannel = "installer_sourced";
  elecBiz = { id: "rec-1", name: "Other Electrical", trading_name: null, rec_number: "REC-99999" };
  snapshot = a4Ticks("1100");
  await generateRectificationQuote("job", "actor");
  expect(of("quotes")[0]).toMatchObject({ subtotal_inc_gst: 1100 + RECTIFICATION_MARGIN_INC_GST });
  expect(of("quote_internals")[0]).toMatchObject({ cost_ex_gst: 1000, calc_snapshot: { rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST, electrician_source: "ours" } });
});

test("decision 351: A1 where the installer chose HIV's electrician (usual saved) → +$100; usual chosen but someone else doing it → +$100", async () => {
  jobChannel = "installer_sourced";
  usualCfg = sparkieUsual;
  elecBiz = { id: "rec-1", name: "Sparkie Co", trading_name: null, rec_number: "REC-12345" };
  choiceEvent = { details: { choice: "hivic" } };
  snapshot = a4Ticks("1100");
  await generateRectificationQuote("job", "actor");
  expect(of("quote_internals")[0].calc_snapshot).toMatchObject({ rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST, electrician_source: "ours" });
  inserts = []; choiceEvent = { details: { choice: "usual" } };
  elecBiz = { id: "rec-1", name: "Other Electrical", trading_name: null, rec_number: "REC-99999" };
  await generateRectificationQuote("job", "actor");
  expect(of("quote_internals")[0].calc_snapshot).toMatchObject({ rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST, electrician_source: "ours" });
});

test("decision 351: A1 rate-card fallback follows the same rule; our lead with our electrician keeps the $100", async () => {
  rectItems = [{ rate_code: "RCD_INSTALL", description: "Install RCD", quantity: 1, is_other: false, explanation: null, needs_office_pricing: false, other_unit_price_inc_gst: null }];
  jobChannel = "installer_sourced";
  usualCfg = sparkieUsual;
  elecBiz = { id: "rec-1", name: "Sparkie Co", trading_name: null, rec_number: "REC-12345" };
  await generateRectificationQuote("job", "actor");
  // CALLOUT 100 ex + RCD 200 ex = 330 inc GST, no margin
  expect(of("quotes")[0].subtotal_inc_gst).toBe(330);
  expect(of("quote_internals")[0].calc_snapshot.rectification_margin_inc_gst).toBe(0);
  inserts = []; jobChannel = "hivic_sourced"; usualCfg = null;
  await generateRectificationQuote("job", "actor");
  // the margin is spread over the lines with unit prices rounded up to the cent (decision 142): +$100 or a few cents over
  expect(of("quotes")[0].subtotal_inc_gst).toBeGreaterThanOrEqual(330 + RECTIFICATION_MARGIN_INC_GST);
  expect(of("quotes")[0].subtotal_inc_gst).toBeLessThan(330 + RECTIFICATION_MARGIN_INC_GST + 0.05);
  expect(of("quote_internals")[0].calc_snapshot.rectification_margin_inc_gst).toBe(RECTIFICATION_MARGIN_INC_GST);
});

// Decision 374 (Jo 25 Oct 2026: "we ALWAYS choose the electrician"): on our leads the electrician is always ours — even
// when the one assigned happens to be the installer's usual electrician — so fixes always carry the decision-142 $100.
test("decision 374: our lead (A2) + the installer's usual electrician assigned → still ours: A3 price + $100", async () => {
  jobChannel = "hivic_sourced";
  usualCfg = { id: "cfg-1", details: { business_id: "rec-1", electrician: { name: "Sparkie Co", licence: "REC 12345", priceIncGst: 220 } } };
  elecBiz = { id: "rec-1", name: "Sparkie Co", trading_name: null, rec_number: "REC-12345" };
  snapshot = a4Ticks("1180");
  await generateRectificationQuote("job", "actor");
  expect(of("quotes")[0]).toMatchObject({ subtotal_inc_gst: 1180 + RECTIFICATION_MARGIN_INC_GST });
  expect(of("quote_internals")[0]).toMatchObject({ cost_ex_gst: 1072.73, calc_snapshot: { rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST, electrician_source: "ours" } });
});

test("decision 349/374: our lead (A2) + OUR electrician (a different REC) → electrician price + $100", async () => {
  jobChannel = "hivic_sourced";
  usualCfg = { id: "cfg-1", details: { business_id: "rec-1", electrician: { name: "Sparkie Co", licence: "REC 12345", priceIncGst: 220 } } };
  elecBiz = { id: "rec-1", name: "Other Electrical", trading_name: null, rec_number: "REC-99999" };
  snapshot = a4Ticks("1180");
  await generateRectificationQuote("job", "actor");
  expect(of("quotes")[0]).toMatchObject({ subtotal_inc_gst: 1180 + RECTIFICATION_MARGIN_INC_GST });
  expect(of("quote_internals")[0]).toMatchObject({ cost_ex_gst: 1072.73, calc_snapshot: { rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST, electrician_source: "ours" } });
});

test("decision 374: rate-card fallback on our lead with the installer's usual electrician assigned → ours: + $100 too", async () => {
  jobChannel = "hivic_sourced";
  usualCfg = { id: "cfg-1", details: { business_id: "rec-1", electrician: { name: "Sparkie Co", licence: "REC 12345", priceIncGst: 220 } } };
  elecBiz = { id: "rec-1", name: "Sparkie Co", trading_name: null, rec_number: "REC-12345" };
  rectItems = [{ rate_code: "RCD_INSTALL", description: "Install RCD", quantity: 1, is_other: false, explanation: null, needs_office_pricing: false, other_unit_price_inc_gst: null }];
  await generateRectificationQuote("job", "actor");
  expect(of("quotes")[0].subtotal_inc_gst).toBeGreaterThanOrEqual(330 + RECTIFICATION_MARGIN_INC_GST);
  expect(of("quotes")[0].subtotal_inc_gst).toBeLessThan(330 + RECTIFICATION_MARGIN_INC_GST + 0.05);
  expect(of("quote_internals")[0].calc_snapshot).toMatchObject({ rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST, electrician_source: "ours" });
});
