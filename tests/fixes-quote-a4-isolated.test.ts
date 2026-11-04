// Decision 305 (Jo 25 Oct 2026) built the owner's fixes quote from the electrician's A3 total (one line + the decision-142
// margin) with the rate-card path for older forms. Part 3 Task 1 (Jo 2 Nov 2026) retired that for EVERY job: the electrician
// quotes, books and bills the upgrades directly, so generateRectificationQuote skips before any read or write. The builder
// and the pure pricing rules are kept behind the predicate (tests/fixes-price.core.test.ts still covers the maths).
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

const scenarios: [string, () => void][] = [
  ["A3 price + included (the old one-line electrician-priced quote)", () => { snapshot = a4("$1,100.00", "Replace 6 downlights with IC-4 LEDs, install 1 RCD"); }],
  ["A3 price with ticked work and a downlight count", () => { snapshot = [...a4("880", null), { label: FIXES_WORK_LABEL, value: "Replace downlights with IC-4 rated LED downlights" }, { label: FIXES_DOWNLIGHT_COUNT_LABEL, value: "6" }]; }],
  ["older form without a price (the old rate-card path)", () => { snapshot = a4(null, null); rectItems = [{ job_id: "job", status: "required", rate_code: "RCD_INSTALL", quantity: 2, description: "Install RCD", is_other: false }]; }],
  ["no rate card at all (used to throw)", () => { snapshot = a4(null, null); electricalCards = []; rectItems = [{ job_id: "job", status: "required", rate_code: "RCD_INSTALL", quantity: 1, description: "Install RCD", is_other: false }]; }],
  ["no fixes items (used to throw)", () => { snapshot = a4(null, null); rectItems = []; }],
  ["HIV lead with our electrician (used to add the $100 margin)", () => { jobChannel = "hivic_sourced"; snapshot = a4("$1,100.00", "RCD"); }],
  ["installer's own job with its usual electrician (used to pass the price through)", () => { jobChannel = "installer_sourced"; usualCfg = { details: { business_id: "rec-1" } }; choiceEvent = { details: { choice: "usual" } }; snapshot = a4("$1,100.00", "RCD"); }],
];
for (const [name, seed] of scenarios) test(`${name} → no HIV upgrades quote: skipped, nothing written, no event`, async () => {
  seed();
  expect(await generateRectificationQuote("job", "actor")).toEqual({ skipped: "electrician_bills" });
  expect(inserts).toEqual([]);
  expect(updates).toEqual([]);
  expect(events).toEqual([]);
});

test("the margin rule is untouched dead code: still $100 for our electrician, nothing for the installer's own", async () => {
  const { fixesMarginFor } = await import("../src/lib/fixes-price.core");
  expect(fixesMarginFor("ours")).toBe(RECTIFICATION_MARGIN_INC_GST);
  expect(fixesMarginFor("installer_usual")).toBe(0);
});
