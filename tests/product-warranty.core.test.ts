// VEU checklist G1 (Jo 25 Oct 2026): product warranty documents for the eight Mitti product options, the completion-pack
// attach/record decision and the AP-signature hold wording. Pure: nothing is sent or read from a database.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ESC_MIN_WARRANTY_YEARS, PRODUCT_WARRANTIES, PRODUCT_WARRANTY_DOC_KIND, WARRANTY_COPY_PROVIDED_EVENT, WARRANTY_DIR, decideWarrantyAttachment, installedProductOptions,
  BRADFORD_CLASS_HOLD, looksLikePdf, meetsEscMinimum, warrantyClassOf, warrantyFamilyForOption, warrantyForOption, warrantyHoldReason, warrantyProvidedSummary, warrantyTermText,
} from "../src/lib/product-warranty.core";
import { classFromPropertyType } from "../src/lib/installer-led.core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PRODUCT_WARRANTY_PDFS } from "../src/lib/product-warranty.data";
import { APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";
import { AP_PREREQ_EVENTS, apPrerequisiteBlockers, type ApPrerequisiteFacts } from "../src/lib/veec-assignment-form.core";
import { renderCompletionPackEmail } from "../src/lib/completion-emails.core";

const onFile = (paths: string[]) => (p: string) => paths.includes(p);
const HOUSE = classFromPropertyType("house"), UNIT = classFromPropertyType("unit");
const bradford = warrantyForOption("Bradford Gold R6", HOUSE)!, bradfordUnit = warrantyForOption("Bradford Gold R6", UNIT)!, pink = warrantyForOption("Fletchers Pink Batts R5")!, earthwool = warrantyForOption("Earthwool R5")!;

describe("product warranty map", () => {
  test("every approved Mitti option maps to a manufacturer warranty with a source and a repo PDF path", () => {
    expect(APPROVED_PRODUCTS).toHaveLength(7);
    for (const p of APPROVED_PRODUCTS) {
      const w = warrantyForOption(p.option, HOUSE);
      expect(w, p.option).not.toBeNull();
      expect(w!.manufacturer.length).toBeGreaterThan(3);
      expect(w!.sourceUrls.length).toBeGreaterThan(0);
      expect(w!.pdfPath.startsWith(`${WARRANTY_DIR}/`)).toBe(true);
      expect(w!.pdfPath.endsWith(".pdf")).toBe(true);
    }
    expect(warrantyFamilyForOption("Bradford Gold R7")).toBe("bradford_gold");
    expect(warrantyFamilyForOption("Fletchers Pink Batts R7")).toBe("pink_batts");
    expect(warrantyFamilyForOption("Earthwool R5")).toBe("earthwool");
    expect(warrantyFamilyForOption("ECOWOOL R5")).toBeNull(); // excluded (Jo 2 Nov 2026)
    expect(warrantyFamilyForOption("ecowool")).toBeNull();
    expect(warrantyFamilyForOption("Knauf something")).toBeNull();
    expect(warrantyFamilyForOption(null)).toBeNull();
  });

  test("terms: Bradford 70 years (Class 1) / 25 years (Class 2 to 10), Pink Batts lifetime, Earthwool 50 years all exceed the ESC 5-year minimum; ECOWOOL is excluded", () => {
    expect(ESC_MIN_WARRANTY_YEARS).toBe(5);
    expect(warrantyTermText(bradford)).toBe("70 years");
    expect(warrantyTermText(bradfordUnit)).toBe("25 years");
    expect(warrantyTermText(pink)).toBe("lifetime");
    expect(warrantyTermText(earthwool)).toBe("50 years");
    expect([bradford, bradfordUnit, pink, earthwool].every(meetsEscMinimum)).toBe(true);
    expect([bradford, bradfordUnit, pink, earthwool].every((w) => w.requestFrom === null)).toBe(true);
    expect(pink.sourceUrls[0]).toBe("https://insulation.com.au/wp-content/uploads/2024/Warranty-Consumer-Lifetime-Product-Pink-Batts-Rev2-290424.pdf");
    expect(PRODUCT_WARRANTIES.map((w) => w.family)).toEqual(["bradford_gold", "bradford_gold", "pink_batts", "earthwool"]);
    // One attachment name per product line (the two Bradford documents are never sent together: one class per job).
    expect(new Set(PRODUCT_WARRANTIES.map((w) => w.attachmentName)).size).toBe(3);
    expect(new Set(PRODUCT_WARRANTIES.map((w) => w.pdfPath)).size).toBe(4);
    // Bradford: Australian CSR source only (no NZ eboss mirror).
    expect(bradford.sourceUrls).toEqual(["https://www.csrbradford.com.au/products/ceiling-insulation/insulation/goldceilingbatts"]);
  });

  test("bundled data: every embedded entry is a known path holding a real PDF (nothing fabricated)", () => {
    const known = new Set(PRODUCT_WARRANTIES.map((w) => w.pdfPath));
    for (const [path, uri] of Object.entries(PRODUCT_WARRANTY_PDFS)) {
      expect(known.has(path), path).toBe(true);
      expect(uri.startsWith("data:application/pdf;base64,")).toBe(true);
      const bytes = new Uint8Array(Buffer.from(uri.slice("data:application/pdf;base64,".length), "base64"));
      expect(looksLikePdf(bytes), path).toBe(true);
      const text = Buffer.from(bytes).toString("latin1");
      // Compressed PDFs (FlateDecode streams) carry no plain text; the Earthwool document is one (checked by eye, 25 Oct 2026).
      if (!/\/FlateDecode/.test(text)) expect(/warrant/i.test(text), `${path} text mentions a warranty`).toBe(true);
    }
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>403"))).toBe(false);
  });
});

const pdfBytes = (path: string) => { const uri = PRODUCT_WARRANTY_PDFS[path]!; return Buffer.from(uri.slice("data:application/pdf;base64,".length), "base64"); };
const pdfText = async (b: Buffer) => { const d = await getDocument({ data: new Uint8Array(b), verbosity: 0 }).promise; let t = ""; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ") + "\n"; return t; };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("Bradford warranty depends on the building class (CSR's current certificates, Jo 3 Nov 2026)", () => {
  test("house or townhouse → the Class 1 certificate (70 years, un-faced)", () => {
    for (const t of ["house", "townhouse"]) {
      const w = warrantyForOption("Bradford Gold R6", classFromPropertyType(t))!;
      expect(w.pdfPath).toBe("docs/product-warranties/bradford-glasswool-warranty-class-1.pdf");
      expect(w.documentTitle).toBe("Bradford Glasswool Insulation Warranty — Class 1 buildings (houses and townhouses), 70 years");
      expect(w.attachmentName).toBe("Bradford-Gold-product-warranty.pdf");
      expect(w.warranty).toEqual({ kind: "years", years: 70 });
    }
    expect(warrantyClassOf("Class 1")).toBe("class_1");
  });

  test("unit → the Class 2 to 10 certificate (25 years, un-faced)", () => {
    const w = warrantyForOption("Bradford Gold R5", classFromPropertyType("unit"))!;
    expect(w.pdfPath).toBe("docs/product-warranties/bradford-glasswool-warranty-class-2-10.pdf");
    expect(w.documentTitle).toBe("Bradford Glasswool Insulation Warranty — Class 2 to 10 buildings (units), 25 years");
    expect(w.attachmentName).toBe("Bradford-Gold-product-warranty.pdf");
    expect(w.warranty).toEqual({ kind: "years", years: 25 });
    expect(warrantyClassOf("Class 2 sole-occupancy unit")).toBe("class_2_10");
    expect(warrantyClassOf("Class 10a")).toBe("class_2_10");
    expect(warrantyClassOf("Class 11")).toBeNull();
  });

  test("class not recorded → no Bradford attachment, and the hold says why", () => {
    for (const c of [null, undefined, "", classFromPropertyType("other"), classFromPropertyType("apartment")]) {
      expect(warrantyForOption("Bradford Gold R6", c)).toBeNull();
      const d = decideWarrantyAttachment(["Bradford Gold R6"], () => true, c);
      expect(d.attach).toEqual([]);
      expect(d.recordProvided).toBe(false);
      expect(d.missing).toEqual([{ product: "Bradford Gold R6", reason: "Building class not recorded — can't choose the Bradford warranty" }]);
      expect(warrantyHoldReason("Bradford Gold R6", c)).toBe("Building class not recorded — can't choose the Bradford warranty");
    }
    expect(BRADFORD_CLASS_HOLD).toBe("Building class not recorded — can't choose the Bradford warranty");
  });

  test("Pink Batts and Earthwool ignore the building class; ECOWOOL keeps its historic hold", () => {
    for (const c of [null, HOUSE, UNIT]) {
      expect(warrantyForOption("Fletchers Pink Batts R5", c)).toBe(pink);
      expect(warrantyForOption("Earthwool R5", c)).toBe(earthwool);
      expect(decideWarrantyAttachment(["Earthwool R5"], () => true, c).recordProvided).toBe(true);
      expect(warrantyHoldReason("ECOWOOL R5", c)).toBe("ECOWOOL is an excluded product — no warranty copy on file.");
    }
  });

  test("bundled: both CSR certificates byte for byte, the old 2010 proof gone, no print-proof marks", async () => {
    const want: [string, string, string, RegExp][] = [
      ["docs/product-warranties/bradford-glasswool-warranty-class-1.pdf", "Bradford_Glasswool_Insulation_-_Class_1_Warranty_Certificate.pdf", "6c0c39b5f42f749188e37ed63b5e00be5492d575b9efaf0a265d32234b18e3be", /Class 1 Building Applications[\s\S]*70 years for Un-faced/],
      ["docs/product-warranties/bradford-glasswool-warranty-class-2-10.pdf", "Bradford_Glasswool_Insulation_-_Class_2-10_Warranty_Certificate.pdf", "da15a2f66aa865376f0f9ecbcef8af6b76f2e19ff71b4004ca21edf9c152b870", /Class 2 to 10 Building Applications[\s\S]*25 years for Un-faced/],
    ];
    for (const [path, incoming, hash, terms] of want) {
      const bytes = pdfBytes(path);
      expect(sha(bytes), path).toBe(hash);
      expect(bytes.equals(readFileSync(new URL(`../${path}`, import.meta.url))), path).toBe(true);
      expect(bytes.equals(readFileSync(new URL(`../docs/product-warranties/_incoming/${incoming}`, import.meta.url))), path).toBe(true);
      const text = (await pdfText(bytes)).replace(/\s+/g, " ");
      expect(text).toMatch(terms);
      expect(text).toContain("CSR Bradford");
      expect(text).not.toContain("PRESS");
      expect(bytes.toString("latin1")).not.toContain("eboss.co.nz");
    }
    expect(Object.keys(PRODUCT_WARRANTY_PDFS).filter((k) => k.includes("bradford")).sort()).toEqual(want.map((w) => w[0]).sort());
    expect(Object.keys(PRODUCT_WARRANTY_PDFS)).not.toContain("docs/product-warranties/bradford-au-lifetime-warranty.pdf");
    expect(existsSync(new URL("../docs/product-warranties/bradford-au-lifetime-warranty.pdf", import.meta.url))).toBe(false); // not in the live folder
  });

  test("ECOWOOL appears in src only as the historic ESC list and the hold wording (never an offered product)", () => {
    const hits = Bun.spawnSync(["grep", "-rli", "ecowool", "src"], { cwd: new URL("..", import.meta.url).pathname }).stdout.toString().trim();
    expect(hits.split("\n").sort()).toEqual(["src/lib/esc-approved-products.core.ts", "src/lib/product-warranty.core.ts"]);
  });

  test("README hold wording for ECOWOOL matches the code exactly", () => {
    const readme = readFileSync(new URL("../docs/product-warranties/README.md", import.meta.url), "utf8");
    expect(readme).toContain(`"${warrantyHoldReason("ECOWOOL R5")}"`);
    expect(readme).toContain(`"${BRADFORD_CLASS_HOLD}"`);
    expect(readme).toContain("6c0c39b5f42f749188e37ed63b5e00be5492d575b9efaf0a265d32234b18e3be");
    expect(readme).toContain("da15a2f66aa865376f0f9ecbcef8af6b76f2e19ff71b4004ca21edf9c152b870");
  });
});

describe("installed products", () => {
  test("install day per-area answers win over the Ready Check product; blanks dropped; no duplicates", () => {
    expect(installedProductOptions({ installDayProducts: ["Bradford Gold R6", null, "Bradford Gold R6", " "], readyCheckProduct: "Earthwool R5" })).toEqual(["Bradford Gold R6"]);
    expect(installedProductOptions({ installDayProducts: ["Bradford Gold R6", "Fletchers Pink Batts R5"], readyCheckProduct: null })).toEqual(["Bradford Gold R6", "Fletchers Pink Batts R5"]);
    expect(installedProductOptions({ installDayProducts: [], readyCheckProduct: "ECOWOOL R5" })).toEqual(["ECOWOOL R5"]); // old stored answer still readable
    expect(installedProductOptions({ installDayProducts: [null], readyCheckProduct: null })).toEqual([]);
  });
});

describe("completion pack attach / record decision", () => {
  test("PDF on file → attached once per manufacturer and the copy is recorded", () => {
    const d = decideWarrantyAttachment(["Bradford Gold R6", "Bradford Gold R5"], onFile([bradford.pdfPath]), HOUSE);
    expect(d.attach.map((w) => w.family)).toEqual(["bradford_gold"]);
    expect(d.missing).toEqual([]);
    expect(d.recordProvided).toBe(true);
  });

  test("PDF not on file → pack still sends, nothing recorded, hold names the product", () => {
    const d = decideWarrantyAttachment(["Bradford Gold R6"], onFile([]), HOUSE);
    expect(d.attach).toEqual([]);
    expect(d.recordProvided).toBe(false);
    expect(d.missing).toHaveLength(1);
    expect(d.missing[0]!.reason).toContain("Warranty copy for Bradford Gold R6 not on file");
  });

  test("two products, one missing → the available one is attached but nothing is recorded (the AP declaration covers every product)", () => {
    const d = decideWarrantyAttachment(["Fletchers Pink Batts R5", "Knauf Jetstream"], onFile([pink.pdfPath]));
    expect(d.attach.map((w) => w.family)).toEqual(["pink_batts"]);
    expect(d.missing.map((m) => m.product)).toEqual(["Knauf Jetstream"]);
    expect(d.recordProvided).toBe(false);
  });

  test("an old job whose stored product is ECOWOL is held with a clear reason, never crashes; no product → nothing recorded", () => {
    const eco = decideWarrantyAttachment(["ECOWOOL R5"], onFile([bradford.pdfPath, pink.pdfPath, earthwool.pdfPath]));
    expect(eco.attach).toEqual([]);
    expect(eco.recordProvided).toBe(false);
    expect(eco.missing).toEqual([{ product: "ECOWOOL R5", reason: "ECOWOOL R5 is not one of the approved product options, so no warranty document is mapped to it." }]);
    expect(warrantyHoldReason("ECOWOOL R5")).toBe("ECOWOOL is an excluded product — no warranty copy on file.");
    expect(decideWarrantyAttachment(["Bradford Gold R6", "ECOWOOL R5"], onFile([bradford.pdfPath]), HOUSE).recordProvided).toBe(false);
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
    expect(warrantyHoldReason("ECOWOOL R5")).toBe("ECOWOOL is an excluded product — no warranty copy on file.");
    expect(warrantyHoldReason("Bradford Gold R6", HOUSE)).toContain("https://www.csrbradford.com.au/");
    // A Bradford gap with no building class names the class, not a missing file.
    expect(apPrerequisiteBlockers({ ...base, warrantyProductsNotOnFile: ["Bradford Gold R6"], warrantyBuildingClass: null })).toEqual([BRADFORD_CLASS_HOLD]);
    expect(apPrerequisiteBlockers({ ...base, warrantyProductsNotOnFile: ["Bradford Gold R6"], warrantyBuildingClass: "Class 1" })).toEqual([warrantyHoldReason("Bradford Gold R6", "Class 1")]);
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
