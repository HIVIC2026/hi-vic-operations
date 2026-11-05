// Jo 5 Nov 16:50 (replaces "View quote (PDF)"): the installer job page shows the owner's quote as the standard
// own-customer rows, read-only, for the business's OWN customer and only to price-seeing people (boss, or Office with
// Money on). The server read (installerJobPageParts) leaves it out everywhere else — never on a Home Insulation Victoria lead.
import { expect, mock, test } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("live database used"); } } }));
const { installerJobPageParts } = await import("../src/lib/trade-view.server");

const items = [
  { code: "INSTALLER_PRICE", description: "Supply and install of Bradford Gold R5 ceiling insulation – 80 m²", sort: 0, line_total_inc_gst: 2400 },
  { code: "AP_FEE", description: "Home Insulation Victoria fee", sort: 1, line_total_inc_gst: 349 },
  { code: "PIESA", description: "Electrical safety check (PIESA)", sort: 2, line_total_inc_gst: 349 },
];
const parts = (o: { channel?: string; origin?: string | null; c?: Record<string, unknown> } = {}) => installerJobPageParts({
  c: { biz: { id: "nogap", name: "No Gap" }, prices: true, money: true, boss: true, ...(o.c ?? {}) } as never,
  j: { job_number: "HV-9002", stage: "quote_sent", channel: o.channel ?? "installer_sourced", installation_completed_at: null, electrician_choice: null, originating_installer_business_id: o.origin === undefined ? "nogap" : o.origin, life_support_status: null, owners: { full_name: "Helen Yang", phone: "0400000000", email: "h@x.test" } },
  rcBook: null, inBook: null, piesaBook: null, a: null,
  m: { measured_area_m2: 80, removal_m2: 0, removal_required: false, access_difficulty: "easy", raw_snapshot: { photo_quote: { installM2: 80 } }, external_source: "photo_quote" } as never,
  form: { auditId: null, complete: false }, clearance: { cleared: false },
  quote: { sent: true }, qq: null, pay: null, elecName: null, piesaRec: null, accessPerson: null, mineBk: [], released: true,
  sentRows: [], ledger: [], depositPaid: false, deadline: null, givenAt: null, consentSigned: false, paidEv: [], piesaPayRead: null, swmsRead: null,
  quoteItems: items,
  quotesForMoney: [{ status: "issued", created_at: "2026-11-06T01:00:00Z", customer_total_inc_gst: 1898, veec_discount_inc_gst: 1200, items }],
  priceEntered: true, notes: [], product: "Bradford Gold R5", payRow: null, mittiCompleted: false, needsFinishingItems: [], mittiMissing: [],
  whoBooks: "installer" as never, coesOnFile: false, photoGive: null,
});

test("own customer, boss: the standard own-customer rows from the quote's own lines", () => {
  const b = parts().quoteBreakdown!;
  expect(b.map((r) => r.label)).toEqual(["Insulation — Supply and install of Bradford Gold R5 ceiling insulation – 80 m²", "Home Insulation Victoria fee", "Electrical safety check (PIESA) — charged by Home Insulation Victoria", "Rebate", "Your price"]);
  expect(b.map((r) => r.amount)).toEqual(["$2,400", "$349", "$349", "−$1,200", "$1,898"]);
});
test("Office with Money on sees it; Office without Money, Lead Installer / Crew do not", () => {
  expect(parts({ c: { boss: false, money: true } }).quoteBreakdown).not.toBeNull();
  expect(parts({ c: { boss: false, money: false } }).quoteBreakdown).toBeNull();
  expect(parts({ c: { boss: false, money: false, prices: false } }).quoteBreakdown).toBeNull();
});
test("refused server side on a Home Insulation Victoria lead and on another business's customer", () => {
  expect(parts({ channel: "hivic_sourced", origin: null }).quoteBreakdown).toBeNull();
  expect(parts({ origin: "other" }).quoteBreakdown).toBeNull();
});
test("a line set the approved rows can't show → no breakdown (never a guessed row)", async () => {
  const { ownQuoteBreakdown } = await import("../src/lib/own-photo-quote.core");
  expect(ownQuoteBreakdown([{ status: "issued", created_at: "x", customer_total_inc_gst: 1898, veec_discount_inc_gst: 1200, items: items.slice(0, 2) }])).toBeNull();
  expect(ownQuoteBreakdown([])).toBeNull();
});
