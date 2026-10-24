// VEU checklist G1 (Jo 25 Oct 2026): product warranty documents for the eight Mitti product options, the completion-pack
// attach/record decision and the AP-signature hold wording. Pure: nothing is sent or read from a database.
import { describe, expect, test } from "bun:test";
import {
  ESC_MIN_WARRANTY_YEARS, PRODUCT_WARRANTIES, PRODUCT_WARRANTY_DOC_KIND, WARRANTY_COPY_PROVIDED_EVENT, WARRANTY_DIR, decideWarrantyAttachment, installedProductOptions,
  looksLikePdf, meetsEscMinimum, warrantyFamilyForOption, warrantyForOption, warrantyHoldReason, warrantyProvidedSummary, warrantyTermText,
} from "../src/lib/product-warranty.core";
import { PRODUCT_WARRANTY_PDFS } from "../src/lib/product-warranty.data";
import { APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";
import { AP_PREREQ_EVENTS, apPrerequisiteBlockers, type ApPrerequisiteFacts } from "../src/lib/veec-assignment-form.core";
import { renderCompletionPackEmail } from "../src/lib/completion-emails.core";

const onFile = (paths: string[]) => (p: string) => paths.includes(p);
const bradford = warrantyForOption("Bradford Gold R6")!, pink = warrantyForOption("Fletchers Pink Batts R5")!, earthwool = warrantyForOption("Earthwool R5")!, ecowool = warrantyForOption("ECOWOOL R5")!;

describe("product warranty map", () => {
  test("every one of the eight Mitti options maps to a manufacturer warranty with a source and a repo PDF path", () => {
    expect(APPROVED_PRODUCTS).toHaveLength(8);
    for (const p of APPROVED_PRODUCTS) {
      const w = warrantyForOption(p.option);
      expect(w, p.option).not.toBeNull();
      expect(w!.manufacturer.length).toBeGreaterThan(3);
      expect(w!.sourceUrls.length).toBeGreaterThan(0);
      expect(w!.pdfPath.startsWith(`${WARRANTY_DIR}/`)).toBe(true);
      expect(w!.pdfPath.endsWith(".pdf")).toBe(true);
    }
    expect(warrantyFamilyForOption("Bradford Gold R7")).toBe("bradford_gold");
    expect(warrantyFamilyForOption("Fletchers Pink Batts R7")).toBe("pink_batts");
    expect(warrantyFamilyForOption("Earthwool R5")).toBe("earthwool");
    expect(warrantyFamilyForOption("ECOWOOL R5")).toBe("ecowool");
    expect(warrantyFamilyForOption("Knauf something")).toBeNull();
    expect(warrantyFamilyForOption(null)).toBeNull();
  });

  test("terms: Bradford 70 years, Pink Batts lifetime, Earthwool 50 years all exceed the ESC 5-year minimum; ECOWOOL is unconfirmed and to be requested", () => {
    expect(ESC_MIN_WARRANTY_YEARS).toBe(5);
    expect(warrantyTermText(bradford)).toBe("70 years");
    expect(warrantyTermText(pink)).toBe("lifetime");
    expect(warrantyTermText(earthwool)).toBe("50 years");
    expect(warrantyTermText(ecowool)).toBe("not confirmed");
    expect([bradford, pink, earthwool].every(meetsEscMinimum)).toBe(true);
    expect(meetsEscMinimum(ecowool)).toBe(false);
    expect(ecowool.requestFrom).toContain("sales@pgfinsulation.com.au");
    expect([bradford, pink, earthwool].every((w) => w.requestFrom === null)).toBe(true);
    expect(pink.sourceUrls[0]).toBe("https://insulation.com.au/wp-content/uploads/2024/Warranty-Consumer-Lifetime-Product-Pink-Batts-Rev2-290424.pdf");
    expect(PRODUCT_WARRANTIES.map((w) => w.family)).toEqual(["bradford_gold", "pink_batts", "earthwool", "ecowool"]);
    expect(new Set(PRODUCT_WARRANTIES.map((w) => w.attachmentName)).size).toBe(4);
  });

  test("bundled data: every embedded entry is a known path holding a real PDF (nothing fabricated)", () => {
    const known = new Set(PRODUCT_WARRANTIES.map((w) => w.pdfPath));
    for (const [path, uri] of Object.entries(PRODUCT_WARRANTY_PDFS)) {
      expect(known.has(path), path).toBe(true);
      expect(uri.startsWith("data:application/pdf;base64,")).toBe(true);
      const bytes = new Uint8Array(Buffer.from(uri.slice("data:application/pdf;base64,".length), "base64"));
      expect(looksLikePdf(bytes), path).toBe(true);
      expect(/warrant/i.test(Buffer.from(bytes).toString("latin1")), `${path} text mentions a warranty`).toBe(true);
    }
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>403"))).toBe(false);
  });
});

describe("installed products", () => {
  test("install day per-area answers win over the Ready Check product; blanks dropped; no duplicates", () => {
    expect(installedProductOptions({ installDayProducts: ["Bradford Gold R6", null, "Bradford Gold R6", " "], readyCheckProduct: "Earthwool R5" })).toEqual(["Bradford Gold R6"]);
    expect(installedProductOptions({ installDayProducts: ["Bradford Gold R6", "Fletchers Pink Batts R5"], readyCheckProduct: null })).toEqual(["Bradford Gold R6", "Fletchers Pink Batts R5"]);
    expect(installedProductOptions({ installDayProducts: [], readyCheckProduct: "ECOWOOL R5" })).toEqual(["ECOWOOL R5"]);
    expect(installedProductOptions({ installDayProducts: [null], readyCheckProduct: null })).toEqual([]);
  });
});

describe("completion pack attach / record decision", () => {
  test("PDF on file → attached once per manufacturer and the copy is recorded", () => {
    const d = decideWarrantyAttachment(["Bradford Gold R6", "Bradford Gold R5"], onFile([bradford.pdfPath]));
    expect(d.attach.map((w) => w.family)).toEqual(["bradford_gold"]);
    expect(d.missing).toEqual([]);
    expect(d.recordProvided).toBe(true);
  });

  test("PDF not on file → pack still sends, nothing recorded, hold names the product", () => {
    const d = decideWarrantyAttachment(["Bradford Gold R6"], onFile([]));
    expect(d.attach).toEqual([]);
    expect(d.recordProvided).toBe(false);
    expect(d.missing).toHaveLength(1);
    expect(d.missing[0]!.reason).toContain("Warranty copy for Bradford Gold R6 not on file");
  });

  test("two products, one missing → the available one is attached but nothing is recorded (the AP declaration covers every product)", () => {
    const d = decideWarrantyAttachment(["Fletchers Pink Batts R5", "ECOWOOL R5"], onFile([pink.pdfPath]));
    expect(d.attach.map((w) => w.family)).toEqual(["pink_batts"]);
    expect(d.missing.map((m) => m.product)).toEqual(["ECOWOOL R5"]);
    expect(d.recordProvided).toBe(false);
    expect(d.missing[0]!.reason).toContain("to be requested from PGF Australia (sales@pgfinsulation.com.au)");
  });

  test("ECOWOOL with a PDF but an unconfirmed term is still not recorded; no product → nothing recorded; unknown option → missing", () => {
    const eco = decideWarrantyAttachment(["ECOWOOL R5"], onFile([ecowool.pdfPath]));
    expect(eco.attach).toEqual([]);
    expect(eco.recordProvided).toBe(false);
    expect(eco.missing[0]!.reason).toContain("ESC minimum of 5 years");
    expect(decideWarrantyAttachment([], onFile([bradford.pdfPath])).recordProvided).toBe(false);
    const unknown = decideWarrantyAttachment(["Knauf Jetstream"], onFile([]));
    expect(unknown.missing[0]!.reason).toContain("not one of the approved product options");
  });

  test("event and document names match the office path and the job file", () => {
    expect(WARRANTY_COPY_PROVIDED_EVENT).toBe(AP_PREREQ_EVENTS.WARRANTY_COPY_PROVIDED);
    expect(PRODUCT_WARRANTY_DOC_KIND).toBe("product_warranty");
    expect(warrantyProvidedSummary([bradford])).toBe("Consumer given the product warranty against defects with the completion pack: Bradford Gold (CSR Bradford (CSR Building Products Ltd), 70 years)");
  });
});

describe("AP signature hold (decision 271 prerequisite)", () => {
  const base: ApPrerequisiteFacts = {
    installStart: "2026-11-10T22:00:00Z", piesaCopyToInstallerAt: "2026-11-01T00:00:00Z", piesaCopyToOwnerAt: "2026-11-01T00:00:00Z", escNotificationSentAt: "2026-11-05T00:00:00Z",
    warrantyCopyProvidedAt: null, collectionNotices: [{ installer: "Sam", providedAt: "2026-10-01T00:00:00Z" }],
  };
  test("holds with 'warranty copy for <product> not on file' when the installed product's PDF is missing", () => {
    expect(apPrerequisiteBlockers({ ...base, warrantyProductsNotOnFile: ["ECOWOOL R5"] })).toEqual([warrantyHoldReason("ECOWOOL R5")]);
    expect(warrantyHoldReason("ECOWOOL R5")).toBe("Warranty copy for ECOWOOL R5 not on file (to be requested from PGF Australia (sales@pgfinsulation.com.au)).");
    expect(warrantyHoldReason("Bradford Gold R6")).toContain("https://www.csrbradford.com.au/");
  });
  test("keeps the generic wording when no product gap is known, and clears once the copy is recorded", () => {
    expect(apPrerequisiteBlockers(base)).toEqual(["Product warranty copy (minimum 5 years) given to the consumer is not recorded."]);
    expect(apPrerequisiteBlockers({ ...base, warrantyProductsNotOnFile: [] })).toEqual(["Product warranty copy (minimum 5 years) given to the consumer is not recorded."]);
    expect(apPrerequisiteBlockers({ ...base, warrantyCopyProvidedAt: "2026-11-12T00:00:00Z", warrantyProductsNotOnFile: ["ECOWOOL R5"] })).toEqual([]);
  });
});

describe("O47 wording with an attachment", () => {
  const input = { firstName: "Helen", installer: { name: "Reinsulate", phone: "0400 000 000" }, downloads: { certificateUrl: null, invoiceUrl: null, warrantiesUrl: null, signedFormsUrl: null } };
  test("names the attached manufacturer warranty; unchanged when nothing is attached", () => {
    const withPdf = renderCompletionPackEmail({ ...input, attachedWarranties: ["Bradford Gold"] });
    expect(withPdf.html).toContain("1-year installer workmanship · 5-year product warranty · Bradford Gold manufacturer's warranty attached (PDF)");
    expect(withPdf.text).toContain("Bradford Gold manufacturer's warranty attached (PDF)");
    const without = renderCompletionPackEmail({ ...input, attachedWarranties: [] });
    expect(without.html).not.toContain("attached (PDF)");
    expect(without.html).toContain("1-year installer workmanship · 5-year product warranty");
  });
});
