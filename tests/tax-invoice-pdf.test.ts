import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { gstOnFullPriceCents, taxInvoiceModel, type TaxInvoiceFacts } from "../src/lib/tax-invoice-pdf.core";
import { taxInvoicePdf } from "../src/lib/tax-invoice-pdf.server";

const pdfText = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };

const SAMPLE: TaxInvoiceFacts = {
  invoiceNumber: "INV-1234", invoiceDate: "Thu 13 Nov 2026", jobNumber: "HV-1234", ownerName: "Sarah Brown", installAddress: "12 Example St, Box Hill VIC 3128",
  installerName: "Rapid Insulation", installedOn: "Thu 13 Nov 2026",
  productLine: "Bradford Gold Hi-Performance Ceiling Batts · R5.0 · 137 m² · supplied and installed (includes removal of 40 m² of old insulation)",
  productCents: 344900, piesaCents: 34900, rebateCents: 161000,
  payments: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }, { label: "Deposit", paidOn: "10 Nov", cents: 18390 }, { label: "Final payment", paidOn: "13 Nov", cents: 165510 }],
};

test("GST on the full price before the rebate", () => { expect(gstOnFullPriceCents(379800)).toBe(34527); });
test("sample payments add up to the price", () => { expect(SAMPLE.payments.map((p) => p.cents)).toEqual([34900, 18390, 165510]); });
test("sample invoice", () => {
  const m = taxInvoiceModel(SAMPLE) as any;
  expect(m.priceBeforeRebate).toBe("$3,798.00");
  expect(m.rebate).toBe("– $1,610.00");
  expect(m.payable).toBe("$2,188.00");
  expect(m.gstLine).toBe("Includes GST of $345.27, worked out on the price before the rebate (ATO rule for certificate rebates)");
  expect(m.balance).toBe("$0.00 · Paid in full ✓");
});
test("extraLines are added to the price before the rebate", () => {
  const m = taxInvoiceModel({ ...SAMPLE, extraLines: [{ label: "Home Insulation Victoria fee", cents: 34900 }], rebateCents: 161000 }) as any;
  expect(m.priceBeforeRebate).toBe("$4,147.00");
  expect(m.rows.map((r: any) => r.label)).toContain("Home Insulation Victoria fee");
  expect(m.gstLine).toContain("$377.00");
});
test("an unpaid part shows what is still to pay", () => {
  expect((taxInvoiceModel({ ...SAMPLE, payments: SAMPLE.payments.slice(0, 1) }) as any).balance).toBe("$1,839.00 still to pay");
});
test("every ESC field is printed", async () => {
  const r = (await taxInvoicePdf(SAMPLE)) as any;
  const pages = await pdfText(r.bytes);
  const t = pages.join(" ").replace(/\s+/g, " ");
  expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(1);
  for (const s of ["Tax invoice", "Invoice INV-1234", "Bill to", "Installation address", "Contracting business (Accredited Person)", "ABN 44 671 613 979", "1/33 Altree Court, Phillip ACT 2606", "VEU Accredited Person A003654", "Installed by", "Rapid Insulation, on Thu 13 Nov 2026", "Victorian Energy Upgrades rebate (price reduction)"]) expect(t.toLowerCase()).toContain(s.toLowerCase()); // labels are drawn in capitals, as in the approved sample
  // consumer name, address, business name/address/ABN, brand + model + R-value, total m², price before, incentive, amount paid after, date
  for (const s of ["Sarah Brown", "12 Example St, Box Hill VIC 3128", "DC Construction Solutions Pty Ltd", "Bradford Gold Hi-Performance Ceiling Batts", "R5.0", "137 m²", "$3,798.00", "– $1,610.00", "$2,188.00", "Date Thu 13 Nov 2026"]) expect(t).toContain(s);
  expect(t).not.toMatch(/lawyer/i);
  expect(Buffer.from(r.bytes).toString("latin1")).not.toMatch(/lawyer/i);
});
test("missing invoice number or product holds", async () => {
  expect(taxInvoiceModel({ ...SAMPLE, invoiceNumber: null })).toEqual({ held: "Tax invoice not made: no invoice number yet" });
  expect(taxInvoiceModel({ ...SAMPLE, productLine: null })).toEqual({ held: "Tax invoice not made: installed product not confirmed" });
  expect(await taxInvoicePdf({ ...SAMPLE, invoiceNumber: " " })).toEqual({ held: "Tax invoice not made: no invoice number yet" });
});
describe("other missing facts hold, never a blank", () => {
  for (const [k, why] of [["ownerName", "the owner's name"], ["installAddress", "the installation address"], ["installerName", "who installed it"], ["installedOn", "the install date"], ["invoiceDate", "the invoice date"]] as const)
    test(k, () => expect(taxInvoiceModel({ ...SAMPLE, [k]: "" })).toEqual({ held: `Tax invoice not made: ${why} is missing` }));
  test("rebate bigger than the price", () => expect(taxInvoiceModel({ ...SAMPLE, rebateCents: 400000 })).toEqual({ held: "Tax invoice not made: the rebate is more than the price" }));
  test("paid more than payable", () => expect(taxInvoiceModel({ ...SAMPLE, payments: [{ label: "x", paidOn: "1 Nov", cents: 300000 }] })).toEqual({ held: "Tax invoice not made: payments are more than the amount payable" }));
});

import { paymentPlan } from "../src/lib/payments.core";
import { removalM2ForInvoice, taxInvoicePayments, taxInvoiceProductLine } from "../src/lib/tax-invoice-pdf.core";
describe("product line with old-insulation removal", () => {
  const line = { brand: "Bradford", model: "Gold Hi-Performance Ceiling Batts", rValue: "R5.0", areaM2: 137 };
  test("with removal, from the quote snapshot (wins over the measurement)", () => {
    const n = removalM2ForInvoice({ removal_m2: 40 }, { removal_required: true, removal_m2: 55 });
    expect(taxInvoiceProductLine(line, n)).toBe("Bradford Gold Hi-Performance Ceiling Batts · R5.0 · 137 m² · supplied and installed (includes removal of 40 m² of old insulation)");
  });
  test("snapshot without removal falls back to the current measurement", () => {
    expect(removalM2ForInvoice({}, { removal_required: true, removal_m2: 25 })).toBe(25);
    expect(removalM2ForInvoice(null, { removal_required: false, removal_m2: 25 })).toBeNull();
  });
  test("without removal nothing is appended", () => {
    for (const n of [removalM2ForInvoice({ removal_m2: 0 }, { removal_required: true, removal_m2: 25 }), removalM2ForInvoice(null, null)])
      expect(taxInvoiceProductLine(line, n)).toBe("Bradford Gold Hi-Performance Ceiling Batts · R5.0 · 137 m² · supplied and installed");
  });
  test("no product, no line", () => expect(taxInvoiceProductLine(null, 40)).toBeNull());
});
describe("payments are this installation invoice's only", () => {
  const plan = paymentPlan({ quoteTotalCents: 218800, safetyCheckCents: 34900 });
  const own = [{ amountCents: 34900, paidAt: "2026-11-08T01:00:00Z", source: "card" }, { amountCents: 18390, paidAt: "2026-11-10T01:00:00Z", source: "card" }];
  test("list and total from the own ledger", () => {
    const r = taxInvoicePayments(plan, own, (iso) => iso.slice(5, 10));
    expect(r.received).toBe(53290);
    expect(r.payments.map((p) => p.cents)).toEqual([34900, 18390]);
  });
  test("a repeat-PIESA payment recorded on its own invoice is not in the invoice's ledger", async () => {
    const events = [
      { id: "1", event_type: "owner_payment_recorded", created_at: "2026-11-08T01:00:00Z", actor_id: null, details: { invoice_id: "inst", amount_cents: 34900, source: "card", receipt_key: "a" } },
      { id: "2", event_type: "owner_payment_recorded", created_at: "2026-11-09T01:00:00Z", actor_id: null, details: { invoice_id: "repeat", amount_cents: 34900, source: "card", receipt_key: "b" } },
    ];
    const chain: any = { select: () => chain, eq: () => chain, in: () => chain, order: async () => ({ data: events }), then: (r: any) => r({ data: [] }) };
    mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => chain } }));
    const { rawPaymentLedger } = await import("../src/lib/payment-ledger.server");
    const ledger = await rawPaymentLedger("job", "inst");
    expect(ledger.length).toBe(1);
    const r = taxInvoicePayments(plan, ledger, () => "8 Nov");
    expect(r.received).toBe(34900);
    expect(r.payments).toEqual([{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }]);
  });
});

/* ---------------------------------------------------------------- Part 10 Task 7: an installer's own customer (co-branded, approved lines) */
import { LOGO_PNG } from "../src/lib/email-hero-assets";
import { taxInvoiceBlocks } from "../src/lib/tax-invoice-pdf.server";
import { OWN_CUSTOMER_COBRAND_APPROVED } from "../src/lib/cobrand.core";

// Jo 4 Nov 2026: the own-customer PIESA line is the installer's own rate — Rapid's $275 (the fee stays $349).
const OWN: TaxInvoiceFacts = {
  ...SAMPLE, productLine: "Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed", productCents: 200000, piesaCents: 27500, rebateCents: 60000,
  extraLines: [{ label: "Home Insulation Victoria fee", cents: 34900 }],
  payments: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 27500 }],
  ownCustomer: { installerName: "Rapid Insulation", installerLogoUrl: "https://x/rapid-logo.png", installerLogo: { bytes: new Uint8Array(Buffer.from(LOGO_PNG, "base64")), width: 400, height: 171 } },
};
const seam = { cobrandApproved: true };

describe("own customer tax invoice (Task 7)", () => {
  test("approved + logo: both logos in the header, the five labels in order, GST on the full price before the rebate", async () => {
    const r = (await taxInvoicePdf(OWN, seam)) as { bytes: Uint8Array; layout: { images: { block: string }[] } };
    const t = (await pdfText(r.bytes)).join(" ").replace(/\s+/g, " ");
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(1);
    const at = (s: string) => { const i = t.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const order = ["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain("Includes GST of $238.55, worked out on the price before the rebate");
    expect(t).toContain("Insulation · Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed");
    expect(t).toContain("$275.00");
    expect(t).toContain("$2,624.00");
    expect(t).toContain("– $600.00");
    expect(t).toContain("$2,024.00");
    expect(t).not.toMatch(/VEU rebate|Victorian Energy Upgrades rebate \(price reduction\)|lawyer|\bHIV\b|\bfixes\b/);
    // every ESC field Part 1 prints is still there
    for (const s of ["Tax invoice", "Invoice INV-1234", "Bill to", "Installation address", "Contracting business (Accredited Person)", "ABN 44 671 613 979", "1/33 Altree Court, Phillip ACT 2606", "VEU Accredited Person A003654", "Installed by", "Rapid Insulation, on Thu 13 Nov 2026"]) expect(t.toLowerCase()).toContain(s.toLowerCase());
    for (const s of ["Sarah Brown", "12 Example St, Box Hill VIC 3128", "DC Construction Solutions Pty Ltd", "Date Thu 13 Nov 2026"]) expect(t).toContain(s);
    // the installer's logo is drawn in the header block
    expect(r.layout.images.map((i) => i.block)).toEqual(["t-head"]);
    const m = taxInvoiceModel(OWN, seam) as any;
    expect(m.rows.map((x: any) => x.label)).toEqual(["Insulation · Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed", "Home Insulation Victoria fee", "Electrical safety check (PIESA)"]);
    expect(m.rebateLabel).toBe("Rebate");
    expect(m.payableLabel).toBe("Your price (incl. GST)");
  });
  test("extras sit between Insulation and the fee, under their own words", () => {
    const m = taxInvoiceModel({ ...OWN, extraLines: [{ label: "Removal of existing insulation (40 m²)", cents: 30000 }, { label: "Home Insulation Victoria fee", cents: 34900 }] }, seam) as any;
    expect(m.rows.map((x: any) => x.label)).toEqual(["Insulation · Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed", "Removal of existing insulation (40 m²)", "Home Insulation Victoria fee", "Electrical safety check (PIESA)"]);
    expect(m.priceBeforeRebate).toBe("$2,924.00");
  });
  test("no logo (null, http, missing bytes) → one logo, same rows", async () => {
    for (const own of [{ ...OWN.ownCustomer!, installerLogo: null }, { ...OWN.ownCustomer!, installerLogoUrl: "http://x/logo.png" }, { ...OWN.ownCustomer!, installerLogoUrl: null, installerLogo: null }]) {
      const r = (await taxInvoicePdf({ ...OWN, ownCustomer: own }, seam)) as { bytes: Uint8Array; layout: { images: { block: string }[] } };
      expect(r.layout.images).toEqual([]);
      const t = (await pdfText(r.bytes)).join(" ").replace(/\s+/g, " ");
      expect(t).toContain("Home Insulation Victoria fee");
      expect(t).toContain("Your price");
    }
  });
  test("a Home Insulation Victoria lead → Part 1's invoice exactly (model + blocks pinned at 40340e1), whatever the co-brand switch (ON since go-live 5 Nov 2026)", () => {
    expect(typeof OWN_CUSTOMER_COBRAND_APPROVED).toBe("boolean");
    const hiv = taxInvoiceModel(SAMPLE) as any;
    expect(JSON.stringify(hiv)).toBe(MODEL_PIN);
    expect(JSON.stringify(taxInvoiceBlocks(SAMPLE, hiv))).toBe(BLOCKS_PIN);
    expect(JSON.stringify(taxInvoiceModel(SAMPLE, seam))).toBe(MODEL_PIN); // no ownCustomer → unchanged even with the seam on
    const off = taxInvoiceModel(OWN, { cobrandApproved: false }) as any; // switch off → generic rows and labels (Part 1's), no logo
    expect(off.rows.map((x: any) => x.label)).toEqual(["Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed", "Electrical safety check (PIESA)", "Home Insulation Victoria fee"]);
    expect(off.rebateLabel).toBeUndefined();
    expect(JSON.stringify(taxInvoiceBlocks(OWN, off))).not.toContain("partnerLogo");
  });
});
const MODEL_PIN = "{\"rows\":[{\"label\":\"Bradford Gold Hi-Performance Ceiling Batts · R5.0 · 137 m² · supplied and installed (includes removal of 40 m² of old insulation)\",\"amount\":\"$3,449.00\"},{\"label\":\"Electrical safety check (PIESA)\",\"amount\":\"$349.00\"}],\"priceBeforeRebate\":\"$3,798.00\",\"rebate\":\"– $1,610.00\",\"payable\":\"$2,188.00\",\"gstLine\":\"Includes GST of $345.27, worked out on the price before the rebate (ATO rule for certificate rebates)\",\"balance\":\"$0.00 · Paid in full ✓\",\"payments\":[{\"label\":\"Electrical safety check (PIESA), 8 Nov\",\"amount\":\"– $349.00\"},{\"label\":\"Deposit, 10 Nov\",\"amount\":\"– $183.90\"},{\"label\":\"Final payment, 13 Nov\",\"amount\":\"– $1,655.10\"}]}";
const BLOCKS_PIN = "[{\"id\":\"t-head\",\"kind\":\"header\",\"eyebrow\":\"TAX INVOICE · JOB HV-1234\",\"compact\":true,\"withAddress\":true},{\"id\":\"t-title\",\"kind\":\"title\",\"text\":\"Tax invoice\",\"sub\":\"Invoice INV-1234 · Date Thu 13 Nov 2026\",\"compact\":true},{\"id\":\"t-facts\",\"kind\":\"facts\",\"compact\":true,\"fullFrom\":2,\"rows\":[[\"Bill to\",\"Sarah Brown\"],[\"Installation address\",\"12 Example St, Box Hill VIC 3128\"],[\"Contracting business (Accredited Person)\",\"DC Construction Solutions Pty Ltd trading as Home Insulation Victoria · ABN 44 671 613 979 · 1/33 Altree Court, Phillip ACT 2606 · VEU Accredited Person A003654\"],[\"Installed by\",\"Rapid Insulation, on Thu 13 Nov 2026\"]]},{\"id\":\"t-items\",\"kind\":\"ledger\",\"head\":{\"label\":\"Installed\",\"amount\":\"Amount\"},\"note\":\"Includes GST of $345.27, worked out on the price before the rebate (ATO rule for certificate rebates)\",\"rows\":[{\"label\":\"Bradford Gold Hi-Performance Ceiling Batts · R5.0 · 137 m² · supplied and installed (includes removal of 40 m² of old insulation)\",\"amount\":\"$3,449.00\"},{\"label\":\"Electrical safety check (PIESA)\",\"amount\":\"$349.00\"},{\"label\":\"Price before VEU rebate\",\"amount\":\"$3,798.00\",\"strong\":true},{\"label\":\"Victorian Energy Upgrades rebate (price reduction)\",\"amount\":\"– $1,610.00\"}],\"total\":{\"label\":\"Amount payable after rebate (incl. GST)\",\"amount\":\"$2,188.00\"}},{\"id\":\"t-paid\",\"kind\":\"ledger\",\"head\":{\"label\":\"Payments\",\"amount\":\"\"},\"rows\":[{\"label\":\"Electrical safety check (PIESA), 8 Nov\",\"amount\":\"– $349.00\"},{\"label\":\"Deposit, 10 Nov\",\"amount\":\"– $183.90\"},{\"label\":\"Final payment, 13 Nov\",\"amount\":\"– $1,655.10\"}],\"total\":{\"label\":\"Balance\",\"amount\":\"$0.00 · Paid in full\",\"tick\":true}}]";

// Final review M6 / M5: the logo bytes come from storage through Part 5's partnerLogoByKey (never a self-HTTP fetch);
// a $0 AP_FEE line adds no extra row.
describe("M6: fetchPartnerLogo reads the stored logo by key", () => {
  test("only a /api/public/partner-logo/{32-hex} https URL is looked up; anything else → null", async () => {
    const { fetchPartnerLogo } = await import("../src/lib/tax-invoice-pdf.server");
    expect(await fetchPartnerLogo(null)).toBeNull();
    expect(await fetchPartnerLogo("http://x/api/public/partner-logo/" + "a".repeat(32))).toBeNull();
    expect(await fetchPartnerLogo("https://x/logo.png")).toBeNull();
    expect(await fetchPartnerLogo("https://x/api/public/partner-logo/not-a-key.png")).toBeNull();
    expect(await fetchPartnerLogo("https://x/api/public/partner-logo/" + "a".repeat(32))).toBeNull(); // no extension = not our route
    const src = readFileSync("src/lib/tax-invoice-pdf.server.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function fetchPartnerLogo"), src.indexOf("const TAX_INVOICE_KIND"));
    expect(fn).toContain("partnerLogoByKey(key)");
    expect(fn).toContain('storage.from("job-files").download(logo.path)');
    expect(fn).not.toMatch(/\bfetch\(/);
  });
  test("M5: the Home Insulation Victoria fee extra line is added only when its amount is above $0", () => {
    const src = readFileSync("src/lib/tax-invoice-pdf.server.ts", "utf8");
    expect(src).toContain('r.code === "AP_FEE" && cents(r.line_total_inc_gst) > 0');
  });
});

// Review 1 + fix round 1 (Task 6 discount): the discounted own-customer quote carries a negative INSTALLER_DISCOUNT line.
// The tax invoice prints it as "Discount · – $200.00" straight under Insulation and the total still adds up.
describe("own customer tax invoice with the installer's discount", () => {
  const DISCOUNTED: TaxInvoiceFacts = { ...OWN, extraLines: [{ label: "Discount", cents: -20000 }, { label: "Home Insulation Victoria fee", cents: 34900 }] };
  test("Discount row under Insulation, shown like the rebate; price before rebate and payable take it off", () => {
    const m = taxInvoiceModel(DISCOUNTED, seam) as any;
    expect(m.rows.map((x: any) => [x.label, x.amount])).toEqual([
      ["Insulation · Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed", "$2,000.00"],
      ["Discount", "– $200.00"],
      ["Home Insulation Victoria fee", "$349.00"],
      ["Electrical safety check (PIESA)", "$275.00"],
    ]);
    expect(m.priceBeforeRebate).toBe("$2,424.00");
    expect(m.payable).toBe("$1,824.00");
  });
  test("the loader subtracts the INSTALLER_DISCOUNT line as an explicit extra line (not held as 'do not add up')", () => {
    const src = readFileSync("src/lib/tax-invoice-pdf.server.ts", "utf8");
    const own = src.slice(src.indexOf("if (ownJob) {"), src.indexOf("const extrasCents"));
    expect(own).toContain('sorted.filter((r) => r.code === "INSTALLER_DISCOUNT")');
    expect(own).toContain("label: OWN_CUSTOMER_LABELS.discount, cents: cents(r.line_total_inc_gst)");
    expect(own).toContain('"INSTALLER_DISCOUNT"'); // in the approved-codes list, never "not the approved own-customer lines"
    expect(own).toContain("discountLines.some((r) => !(cents(r.line_total_inc_gst) < 0))"); // a positive "discount" holds
    expect(src).toContain("productCents + extrasCents + piesaCents - rebateCents !== cents(inv.total_inc_gst)"); // the sum check now includes it
  });
});
