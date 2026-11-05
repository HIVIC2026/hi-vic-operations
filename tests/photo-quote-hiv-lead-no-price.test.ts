// Review fix round IMPORTANT 3c (Jo 14:50, binding): on a Home Insulation Victoria lead the installer never sees the owner's
// quote or any price. The installer job page parts after "Send for quote" carry no "$" and no quote link — even with the
// quote sent and its priced lines on file. (The installer's OWN pay line is separate and unchanged; with no pay set, it's empty.)
import { expect, mock, test } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("live database used"); } } }));
const { installerJobPageParts } = await import("../src/lib/trade-view.server");

const parts = (o: { pay?: number | null } = {}) => installerJobPageParts({
  c: { biz: { id: "nogap", name: "No Gap" }, prices: true, money: true, boss: true } as never,
  j: { job_number: "HV-9001", stage: "quote_sent", channel: "hivic_sourced", installation_completed_at: null, electrician_choice: null, originating_installer_business_id: null, life_support_status: null, owners: { full_name: "Helen Yang", phone: "0400000000", email: "h@x.test" } },
  rcBook: null, inBook: null, piesaBook: null,
  a: null,
  m: { measured_area_m2: 84.5, removal_m2: 20, removal_required: true, access_difficulty: "easy", raw_snapshot: { photo_quote: { installM2: 84.5 } }, external_source: "photo_quote" } as never,
  form: { auditId: null, complete: false }, clearance: { cleared: false },
  quote: { sent: true }, qq: null, pay: o.pay ?? null, elecName: null, piesaRec: null, accessPerson: null, mineBk: [], released: true,
  sentRows: [{ purpose: "quote_ready", sent_at: "2026-11-06T01:00:00Z", created_at: "2026-11-06T01:00:00Z" }], ledger: [], depositPaid: false,
  deadline: null, givenAt: "2026-11-05T23:00:00Z", consentSigned: false, paidEv: [], piesaPayRead: null, swmsRead: null,
  quoteItems: [{ code: "INSTALLER_PRICE", description: "Bradford Gold R5 supplied and installed", sort: 1, line_total_inc_gst: 2400 }, { code: "PIESA", description: "PIESA", sort: 2, line_total_inc_gst: 349 }, { code: "AP_FEE", description: "AP fee", sort: 3, line_total_inc_gst: 349 }],
  quotesForMoney: [{ status: "issued", created_at: "2026-11-06T01:00:00Z", customer_total_inc_gst: 1898, items: [{ code: "INSTALLER_PRICE", line_total_inc_gst: 2400 }] }],
  priceEntered: null, notes: [], product: "Bradford Gold R5", payRow: null, mittiCompleted: false, needsFinishingItems: [], mittiMissing: [],
  whoBooks: "installer" as never, coesOnFile: false,
  photoGive: { batchId: "B1", businessId: "nogap", givenAt: "2026-11-05T23:00:00Z" },
});

test("HIV lead after Send for quote: no $ amount and no quote link anywhere in the job page parts", () => {
  const p = parts();
  const all = JSON.stringify(p);
  expect(all).not.toContain("$");
  expect(all).not.toMatch(/my-job|screen=quote|https?:\/\//i);
  expect(p.viewQuote).toBe(false);
  expect(p.nextStep).toBeTruthy();
});
test("the only $ an HIV lead page may carry is the installer's own pay line (unchanged), never the owner's price", () => {
  const all = JSON.stringify(parts({ pay: 1500 }));
  expect(all).toContain("1,500");
  for (const ownerFigure of ["1,898", "1898", "2,400", "2400", "349"]) expect(all).not.toContain(ownerFigure);
});
