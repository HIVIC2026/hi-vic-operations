// Decision #29 (Jo 2 Nov 2026): the "Your quote is ready" email (O18) v4 — "Your rebate"/"Rebate", the approved
// upgrades line, Next names the electrical safety check (PIESA), the "What's changed from your estimate" box, the
// 30-day line (30-day quotes only) and the quote documents attached (Customer Agreement + payment terms, Statement of
// rights). Behind OWNER_QUOTE_EMAIL_V4_APPROVED (false): flag off = the v3 email, unchanged, no attachments.
import { beforeEach, describe, expect, mock, test } from "bun:test";

// Plain copies: a mocked module's namespace would otherwise point back at the mock.
const shipped = { ...(await import("../src/lib/owner-quote-email.core")) };
const SHIPPED_V4 = shipped.OWNER_QUOTE_EMAIL_V4_APPROVED;
const SHIPPED_V4_VERSION = shipped.OWNER_QUOTE_EMAIL_V4_VERSION;
const { renderOwnerQuoteEmail, quoteAgreementFacts } = shipped;
const { quoteChangeRows, QUOTE_CHANGES_FOOTNOTE } = await import("../src/lib/quote-changes.core");

const url = "https://estimate.homeinsulationvictoria.com.au/my-job/tok123?screen=quote";
const sample = {
  firstName: "Courtney",
  address: "2A Chatfield Street, Kingsville VIC 3012",
  totalIncGst: 1918,
  rebateIncGst: 1850,
  subtotalIncGst: 3768,
  lines: [
    { description: "R5.0 ceiling insulation, supplied and installed – 120 m²", lineTotalIncGst: 3070 },
    { description: "Electrical safety check (PIESA) by a licensed electrician", lineTotalIncGst: 349 },
    { description: "Home Insulation Victoria management and compliance", lineTotalIncGst: 349 },
  ],
  quoteUrl: url,
  validUntil: new Date("2026-12-10T12:00:00+11:00"),
  validDays: 30 as const,
  officePhone: null,
  unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/unsubscribe/abc",
  safetyCheckPrice: 349,
  areaM2: 120,
  product: "Bradford Gold R5.0",
  installerName: "Reinsulate",
  installerCertified: true,
};
const changes = quoteChangeRows({ estimate: { areaM2: 100, removal: false, price: 1630 }, quote: { areaM2: 120, removal: false, price: 1918 } });

describe("What's changed rows", () => {
  test("only the rows that changed", () => {
    expect(changes).toEqual([{ label: "Ceiling size", estimate: "100 m²", quote: "120 m²" }, { label: "Your price", estimate: "$1,630", quote: "$1,918" }]);
    expect(quoteChangeRows({ estimate: { areaM2: 120, removal: false, price: 1918 }, quote: { areaM2: 120, removal: false, price: 1918 } })).toEqual([]);
  });
  test("removal row when the estimate recorded it; nothing when there was no estimate", () => {
    expect(quoteChangeRows({ estimate: { areaM2: 120, removal: false, price: 1918 }, quote: { areaM2: 120, removal: true, price: 1918 } }))
      .toEqual([{ label: "Old insulation removal", estimate: "No", quote: "Yes" }]);
    expect(quoteChangeRows({ estimate: { areaM2: null, removal: null, price: null }, quote: { areaM2: 120, removal: true, price: 1918 } })).toEqual([]);
  });
  test("a difference that rounds to the same shown value is not a change", () => {
    expect(quoteChangeRows({ estimate: { areaM2: 120.01, removal: null, price: 1918.2 }, quote: { areaM2: 120, removal: false, price: 1918 } })).toEqual([]);
  });
});

describe("v4 email (decision #29)", () => {
  test("approved wording", () => {
    const m = renderOwnerQuoteEmail({ ...sample, v4: true, changes });
    expect(m.text).toContain("What's changed from your estimate");
    expect(m.text).toContain(QUOTE_CHANGES_FOOTNOTE);
    expect(m.text).toContain("Your quote uses what the installer measured at your Ready Check.");
    expect(m.text).toContain("Not included: electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK.");
    expect(m.text).toContain("Your quote is valid for 30 days, until 10 December 2026.");
    expect(m.text).not.toMatch(/VEU rebate|electrical fixes|held until/);
    expect(m.text).toMatch(/electrical safety check \(PIESA\)/);
    expect(m.text).toContain("Next: accept and pay $349.00 → electrical safety check (PIESA) → book your install day.");
    expect(m.text).toContain("Your rebate: you save $1,850.");
    expect(m.text).toContain("Rebate (Taken off upfront, nothing to claim): −$1,850.00");
    expect(m.text).toContain("Ceiling size: estimate 100 m², quote 120 m²");
    expect(m.text).toContain("Your price: estimate $1,630, quote $1,918");
    for (const body of [m.html, m.text]) expect(body).not.toMatch(/\bHIV\b|VEU rebate|held until/);
    expect(m.html).toMatch(/What(&#39;|&#x27;|')s changed from your estimate/);
    expect(m.html).toContain(">Estimate<");
    expect(m.html).toContain(">Quote<");
    // The box sits under the price, above the button.
    expect(m.html.indexOf("changed from your estimate")).toBeGreaterThan(m.html.indexOf(">Your price<"));
    expect(m.html.indexOf("changed from your estimate")).toBeLessThan(m.html.indexOf(">View and accept your quote<"));
  });
  test("no changes → no What's changed box", () => {
    for (const c of [[], undefined]) {
      const m = renderOwnerQuoteEmail({ ...sample, v4: true, changes: c });
      expect(m.text).not.toContain("What's changed");
      expect(m.html).not.toContain("changed from your estimate");
      expect(m.text).not.toContain(QUOTE_CHANGES_FOOTNOTE);
    }
  });
  test("a 14-day quote keeps its held-until line (Task 9 ruling)", () => {
    const m = renderOwnerQuoteEmail({ ...sample, validDays: 14, v4: true, changes });
    expect(m.text).toContain("Your price is held until 10 December 2026.");
    expect(m.text).not.toContain("valid for 30 days");
  });
  test("v3 (flag off) is unchanged", () => {
    const m = renderOwnerQuoteEmail({ ...sample, changes });
    expect(m.text).toContain("Your VEU rebate: you save $1,850.");
    expect(m.text).toContain("electrician safety check");
    expect(m.text).toContain("Your price is held until 10 December 2026.");
    expect(m.text).not.toContain("What's changed");
  });
  test("flag ships off; version recorded", () => {
    expect(SHIPPED_V4).toBe(false);
    expect(SHIPPED_V4_VERSION).toBe("v4-approved-2026-11-02");
  });
});

describe("agreement facts", () => {
  test("filled from the quote and the installer's office contact; missing facts → null", () => {
    const f = quoteAgreementFacts({ input: sample, ownerName: "Courtney Smith", jobNumber: "HV-1234", installer: { name: "Reinsulate Pty Ltd", tradingName: "Reinsulate", officePhone: "03 9000 0000", email: "office@reinsulate.example" }, safetyCents: 34_900 });
    expect(f).toMatchObject({ owner_name: "Courtney Smith", job_number: "HV-1234", installer_name: "Reinsulate", installer_phone: "03 9000 0000", installer_email: "office@reinsulate.example", product: "Bradford Gold R5.0", area_m2: "120", price_before_rebate: "$3,768.00", rebate: "$1,850.00", your_price: "$1,918.00", safety_check: "$349" });
    expect(f?.valid_until).toBe("Thu 10 Dec 2026");
    expect(quoteAgreementFacts({ input: sample, ownerName: "C", jobNumber: "HV-1", installer: { name: "X", tradingName: null, officePhone: null, email: "x@x" }, safetyCents: 34_900 })).toBeNull();
    expect(quoteAgreementFacts({ input: { ...sample, product: null }, ownerName: "C", jobNumber: "HV-1", installer: { name: "X", tradingName: null, officePhone: "1", email: "x@x" }, safetyCents: 34_900 })).toBeNull();
  });
});

/* ---------------------------------------------------------------- sender */

let v4 = true, tplActive = true, sorOnFile = true, officePhone: string | null = "03 9000 0000", sentAt = "2026-11-10T01:00:00Z", source = "website";
const sends: { purpose: string; key: string; mail: { subject: string; text: string; attachments?: { filename: string; contentType: string; content: string }[] } }[] = [];
const testSends: { text: string; attachments: unknown[] }[] = [];
const events: { type: string; details: Record<string, unknown> }[] = [];
const rows: Record<string, unknown> = {};
const resetRows = () => Object.assign(rows, {
  jobs: { owner_id: "o", property_id: "p", job_number: "HV-1234", source, stage: "awaiting_quote_acceptance" },
  owners: { phone: "0400000000", email: "owner@example.com", full_name: "Courtney Smith" },
  quotes: { customer_total_inc_gst: 1918, veec_discount_inc_gst: 1850, subtotal_inc_gst: 3768, sent_at: sentAt, kind: "installation", status: "issued", release_state: "released" },
  quote_items: [{ description: "R5.0 ceiling insulation", line_total_inc_gst: 3070, sort: 1, code: "INSTALL" }, { description: "Electrical safety check (PIESA)", line_total_inc_gst: 349, sort: 2, code: "PIESA" }],
  customer_estimate_links: { token: "tok", status: "active", expires_at: "2099-01-01" },
  properties: { address_line: "2A Chatfield Street", suburb: "Kingsville", postcode: "3012" },
  ceiling_measurements: { measured_area_m2: 120, verified_area_m2: 120, removal_required: false, removal_m2: null },
  workflow_events: { details: { product: { option: "Bradford Gold R5.0" } } },
  job_assignments: { businesses: { name: "Reinsulate", trading_name: null, onboarding_status: "approved", is_active: true } },
  lead_campaign_responses: { saved_total: 1630, saved_area_m2: 100, saved_veu_discount: 1850 },
});

function chain(table: string) {
  const res = () => {
    if (table === "workflow_events" && filters.has("contains")) return { data: [], error: null };
    const v = rows[table];
    return { data: v ?? null, error: null };
  };
  const filters = new Set<string>();
  const q: any = {
    select: () => q, eq: () => q, order: () => q, limit: () => q, in: () => q,
    contains: () => { filters.add("contains"); return q; },
    maybeSingle: () => Promise.resolve(res()),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  };
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: chain } }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: chain } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: Record<string, unknown>) => { events.push({ type, details }); } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async () => ({ status: "sent", detail: "ok", sid: "s" }) }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/unsubscribe/x" }));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { purpose: string; key: string; build: (u: string | null) => any }) => { sends.push({ purpose: p.purpose, key: p.key, mail: p.build("https://u") }); return "sent"; },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: unknown, _to: string, _s: string, _h: string, text: string, opts: { attachments?: unknown[] } = {}) => { testSends.push({ text, attachments: opts.attachments ?? [] }); return { status: "sent", detail: "TEST accepted" }; },
  sendTestSms: async () => ({ status: "sent", detail: "TEST accepted" }),
}));
mock.module("../src/lib/test-send.core", () => ({ isTestPartner: () => true }));
mock.module("../src/lib/customer-agreement.server", () => ({ activeCustomerAgreement: async () => (tplActive ? { version: "1.3", body: "BODY", approvedAt: "2026-11-02T00:00:00Z" } : null) }));
mock.module("../src/lib/customer-agreement-pdf.server", () => ({
  PAYMENT_TERMS_BLOCK_ID: "payment-terms",
  agreementBlocks: () => [{ kind: "header", id: "x" }, { kind: "pageBreak" }, { kind: "header", id: "payment-terms" }],
  customerAgreementPdf: async (t: { version: string }) => ({ bytes: new Uint8Array([37, 80, 68, 70]), layout: {}, fileName: `Customer-Agreement-and-payment-terms-v${t.version}.pdf` }),
}));
const realSor = { ...(await import("../src/lib/statement-of-rights.core")) };
mock.module("../src/lib/statement-of-rights.core", () => ({ ...realSor, statementOfRightsPdf: () => (sorOnFile ? new Uint8Array([37, 80, 68, 70]) : null) }));
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async () => ({ name: "Reinsulate Pty Ltd", tradingName: "Reinsulate", officePhone, email: "office@reinsulate.example" }) }));
// Part 10 Task 5: the own-customer brand reads Part 5's businessLogoUrl (trade-view.server).
let logoUrl: string | null = "https://portal.example/api/public/partner-logo/abc";
mock.module("../src/lib/trade-view.server", () => ({ businessLogoUrl: async () => logoUrl }));
const realQe = { ...(await import("../src/lib/quote-expiry.core")) };
mock.module("../src/lib/quote-expiry.core", () => ({
  ...realQe,
  quoteValidDaysFor: (s: string | Date) => realQe.quoteValidDaysFor(s, "2026-11-01T00:00:00Z"),
  quoteExpiresAt: (s: string | Date) => realQe.quoteExpiresAt(s, "2026-11-01T00:00:00Z"),
}));
let ownOn = false;
const setV4 = (on: boolean) => { v4 = on; mock.module("../src/lib/owner-quote-email.core", () => ({ ...shipped, OWNER_QUOTE_EMAIL_V4_APPROVED: v4, renderOwnerQuoteEmail: (i: Parameters<typeof shipped.renderOwnerQuoteEmail>[0]) => shipped.renderOwnerQuoteEmail(i, { cobrandApproved: ownOn }) })); };
const { notifyOwnerQuoteReady } = await import("../src/lib/quote-ready-notify.server");

describe("quote-ready sender", () => {
  beforeEach(() => { sends.length = 0; testSends.length = 0; events.length = 0; tplActive = true; sorOnFile = true; officePhone = "03 9000 0000"; sentAt = "2026-11-10T01:00:00Z"; source = "website"; resetRows(); setV4(true); });

  test("flag on: v4 wording + the quote documents, same purpose and key as today", async () => {
    const r = await notifyOwnerQuoteReady("j", "q", "installation");
    expect(r.email).toBe("sent");
    expect(sends).toHaveLength(1);
    expect(sends[0]!.purpose).toBe("quote_ready");
    expect(sends[0]!.key).toBe("quote-ready-email:v1:q");
    const m = sends[0]!.mail;
    expect(m.text).toContain("What's changed from your estimate");
    expect(m.text).toContain("Ceiling size: estimate 100 m², quote 120 m²");
    expect(m.text).toContain("Your quote is valid for 30 days, until 10 December 2026.");
    expect(m.attachments?.map((a) => a.filename)).toEqual(["Customer-Agreement-and-payment-terms-v1.3.pdf", "VEU-Statement-of-rights.pdf"]);
    for (const a of m.attachments ?? []) expect(a.contentType).toBe("application/pdf");
  });

  for (const [name, set] of [
    ["Customer Agreement wording not active", () => { tplActive = false; }],
    ["Statement of rights not on file", () => { sorOnFile = false; }],
    ["installer office phone missing", () => { officePhone = null; }],
  ] as const) {
    test(`flag on, ${name} → held, never sent without the documents`, async () => {
      set();
      const r = await notifyOwnerQuoteReady("j", "q", "installation");
      expect(r.email).toContain("Quote documents not ready");
      expect(sends).toHaveLength(0);
      expect(events.some((e) => e.type === "ready_check_needs_office" && e.details.reason === "quote_documents_not_ready")).toBe(true);
    });
  }

  test("flag off: the v3 email, unchanged, no attachments (even with no documents)", async () => {
    setV4(false); tplActive = false; sorOnFile = false;
    const r = await notifyOwnerQuoteReady("j", "q", "installation");
    expect(r.email).toBe("sent");
    expect(sends[0]!.key).toBe("quote-ready-email:v1:q");
    expect(sends[0]!.mail.text).toContain("Your VEU rebate");
    expect(sends[0]!.mail.text).not.toContain("What's changed");
    expect(sends[0]!.mail.attachments ?? []).toEqual([]);
  });

  test("flag on, a 14-day quote (sent before the 30-day change) keeps the v3 email", async () => {
    sentAt = "2026-10-20T01:00:00Z"; resetRows();
    const r = await notifyOwnerQuoteReady("j", "q", "installation");
    expect(r.email).toBe("sent");
    expect(sends[0]!.mail.text).toContain("Your VEU rebate");
    expect(sends[0]!.mail.attachments ?? []).toEqual([]);
  });

  test("TEST job: v4 draft through test-send, documents attached when ready", async () => {
    source = "qa_test"; resetRows(); setV4(false);
    await notifyOwnerQuoteReady("j", "q", "installation");
    expect(sends).toHaveLength(0);
    expect(testSends).toHaveLength(1);
    expect(testSends[0]!.text).toContain("What's changed from your estimate");
    expect(testSends[0]!.attachments).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------- Part 10 Task 5: own customer through the sender */
describe("quote-ready sender — installer's own customer (Task 5)", () => {
  const ownRows = () => Object.assign(rows, {
    jobs: { ...(rows["jobs"] as Record<string, unknown>), channel: "installer_sourced", originating_installer_business_id: "biz-1" },
    businesses: { name: "Rapid Insulation Pty Ltd", trading_name: "Rapid Insulation", branding: { logo_url: logoUrl } },
    quotes: { customer_total_inc_gst: 2098, veec_discount_inc_gst: 600, subtotal_inc_gst: 2698, sent_at: sentAt, kind: "installation", status: "issued", release_state: "released" },
    quote_items: [
      { description: "Insulation works by your installer — includes: Ceiling insulation - supply & install", line_total_inc_gst: 2000, sort: 0, code: "INSTALLER_PRICE" },
      { description: "Home Insulation Victoria fee", line_total_inc_gst: 349, sort: 1, code: "AP_FEE" },
      { description: "Electrical safety check (PIESA)", line_total_inc_gst: 349, sort: 2, code: "PIESA" },
    ],
  });
  beforeEach(() => { sends.length = 0; testSends.length = 0; events.length = 0; tplActive = true; sorOnFile = true; officePhone = "03 9000 0000"; sentAt = "2026-11-10T01:00:00Z"; source = "website"; logoUrl = "https://portal.example/api/public/partner-logo/abc"; resetRows(); ownRows(); });

  test("approved on: the sender passes code + ownCustomer → approved rows, both logos, VEU box, documents still attached", async () => {
    ownOn = true; setV4(true);
    const r = await notifyOwnerQuoteReady("j", "q", "installation");
    expect(r.email).toBe("sent");
    const m = sends[0]!.mail;
    expect(m.text).toContain("Home Insulation Victoria fee: $349.00");
    expect(m.text).toContain("Electrical safety check (PIESA): $349.00");
    expect(m.text).toContain("Rebate: −$600.00");
    expect(m.text).toContain("Your price: $2,098.00");
    expect(m.text).toContain("About the Victorian Energy Upgrades program");
    expect((m as { html?: string }).html ?? "").toContain("https://portal.example/api/public/partner-logo/abc");
    expect(m.attachments?.map((a) => a.filename)).toEqual(["Customer-Agreement-and-payment-terms-v1.3.pdf", "VEU-Statement-of-rights.pdf"]);
  });
  test("approved on, no logo on the business → our logo alone", async () => {
    ownOn = true; setV4(true); logoUrl = null;
    await notifyOwnerQuoteReady("j", "q", "installation");
    const html = (sends[0]!.mail as { html?: string }).html ?? "";
    expect(html).not.toContain("partner-logo");
    expect(html.match(/<img /g)?.length).toBe(1);
    expect(sends[0]!.mail.text).toContain("Your price: $2,098.00");
  });
  test("approved off (as shipped): an own customer gets Part 3's v4 email — no VEU box, one logo, generic rows", async () => {
    ownOn = false; setV4(true);
    await notifyOwnerQuoteReady("j", "q", "installation");
    const m = sends[0]!.mail;
    expect(m.text).not.toContain("Victorian Energy Upgrades program");
    expect(m.text).toContain("You pay: $2,098.00");
    expect(((m as { html?: string }).html ?? "").match(/<img /g)?.length).toBe(1);
  });
});
