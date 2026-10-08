import { describe, expect, test } from "bun:test";
import { FORMS, PRICING_FIELDS, readyCheckVariant, validateQuotedPrice, validateTemplate, mittiAiPrompt } from "../src/lib/mitti-forms.core";
import { buildInstallerQuoteDraft, ownerPriceFromQuoted, quotedPriceFromEntries } from "../src/lib/installer-led.core";
import { parseAudit } from "../src/lib/mitti.core";

const EXTRAS_MISSING = ["Missing: Are any extras needed beyond the standard install and removal?", "Missing: Describe each extra and why it is needed", "Missing: Photos of each extra"];
describe("Ready Check variants", () => {
  test("installer-sourced jobs get the priced form; our leads get evidence-only", () => {
    expect(readyCheckVariant("installer_sourced")).toBe("ready_check_priced");
    expect(readyCheckVariant("hivic_sourced")).toBe("ready_check");
    expect(readyCheckVariant(null)).toBe("ready_check");
  });

  test("both variants share identical evidence fields; priced adds the pricing section", () => {
    const base = FORMS.ready_check.fields.map((f) => f.label);
    const priced = FORMS.ready_check_priced.fields.map((f) => f.label);
    expect(priced.slice(0, base.length)).toEqual(base);
    expect(priced.slice(base.length)).toEqual(PRICING_FIELDS.map((f) => f.label));
    // Evidence-only form must never ask for a customer price (our leads are quoted at our set price).
    expect(base.some((l) => l.toLowerCase().includes("price"))).toBe(false);
  });

  test("areas are measured as length x width; the portal computes m2", () => {
    const labels = FORMS.ready_check.fields.map((f) => f.label);
    expect(labels).toContain("How many separate ceiling areas are there?");
    expect(labels).toContain("Length (m)");
    expect(labels).toContain("Width (m)");
    expect(labels).toContain("Upgrade area diagram or floor plan");
    expect(labels).not.toContain("Measured area m2");
  });

  test("priced variant validates against a matching template; evidence-only template fails it", () => {
    const items = FORMS.ready_check_priced.fields.map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type === "tick" ? "checkbox" : f.type }));
    expect(validateTemplate("ready_check_priced", items).ok).toBe(true);
    const missingPricing = FORMS.ready_check.fields.map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type }));
    const result = validateTemplate("ready_check_priced", missingPricing);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("Total quoted price (inc GST)"))).toBe(true);
  });

  test("AI prompt for the priced form uses tick-what's-included + one total and the draw option", () => {
    const prompt = mittiAiPrompt("ready_check_priced");
    expect(prompt).toContain("What's included in your quote?");
    expect(prompt).toContain('"Total quoted price (inc GST)"');
    expect(prompt).toContain("Do NOT add a price box per item");
    expect(prompt).toContain("DRAW the diagram inside the form");
    expect(mittiAiPrompt("ready_check")).not.toContain("Total quoted price");
  });
});

describe("validateQuotedPrice", () => {
  const R = "R5.0 supply and install", RM = "Removal of existing insulation";
  test("accepts ticked items with one total", () => {
    const r = validateQuotedPrice({ included: [R, RM], totalIncGst: 1600, agreedWithOwner: true, removalRequired: true });
    expect(r.ok).toBe(true);
    expect(r.price?.included).toEqual([R, RM]);
  });
  test("R5.0 must be ticked", () => {
    expect(validateQuotedPrice({ included: [RM], totalIncGst: 400, agreedWithOwner: true, removalRequired: true }).ok).toBe(false);
  });
  test("removal ticked iff an area says Remove", () => {
    expect(validateQuotedPrice({ included: [R], totalIncGst: 1200, agreedWithOwner: true, removalRequired: true }).ok).toBe(false);
    expect(validateQuotedPrice({ included: [R, RM], totalIncGst: 1600, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
  });
  test("Other needs a description; fails closed on missing answers", () => {
    expect(validateQuotedPrice({ included: [R, "Other"], totalIncGst: 1300, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
    expect(validateQuotedPrice({ included: [R, "Other"], otherDescription: "Asbestos check", totalIncGst: 1300, agreedWithOwner: true, removalRequired: false }).ok).toBe(true);
    expect(validateQuotedPrice({ included: [R], totalIncGst: 0, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
    // Agreement is not a blocker any more: the office reviews every quote draft before it is sent (A1 has no such question).
    expect(validateQuotedPrice({ included: [R], totalIncGst: 1200, agreedWithOwner: null, removalRequired: false }).ok).toBe(true);
  });
  test("the installer's own wording for the R5.0 line is accepted and normalised", () => {
    const r = validateQuotedPrice({ included: ["R5.0 ceiling insulation - supply & install"], totalIncGst: 1200, agreedWithOwner: null, removalRequired: false });
    expect(r.ok).toBe(true);
    expect(r.price?.included).toEqual(["R5.0 supply and install"]);
  });
  test("validated price feeds the owner co-branded quote without retyping", () => {
    const r = validateQuotedPrice({ included: [R], totalIncGst: 1200, agreedWithOwner: true, removalRequired: false });
    const owner = ownerPriceFromQuoted(r.price!, { piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 500 });
    expect(owner.total).toBe(1200 + 349 + 349);
  });
});

describe("the real Mitti templates", () => {
  // Shape copied from the live A1 template (template_01ee0428be6d4435b34d8b738935f099), one item per repeat instance.
  const A1 = [
    ["Portal Job Number", "textsingle"], ["Site address", "textsingle"], ["Homeowner name", "textsingle"],
    ["Property type", "textsingle"], ["Life support equipment at property?", "textsingle"],
    ["Are the property details provided above correct?", "question"], ["What needs to be corrected?", "textsingle"],
    ["Assessor", "textsingle"], ["What type of roof does the home have?", "list"], ["How would you rate the ceiling access?", "list"],
    ["Upload a clear photo of the ceiling access point", "media"], ["How many ceiling areas need to be measured separately?", "list"],
    ["Which part of the home does this ceiling area cover?", "textsingle"], ["Enter the measured ceiling area (m²)", "number"],
    ["Is there existing insulation in this ceiling area?", "list"],
    ["What type of existing insulation is installed? Select all that apply", "list"],
    ["What is the measured insulation depth (mm)?", "number"], ["Upload a photo clearly showing the measured insulation depth", "media"],
    ["What is required for the existing insulation?", "list"], ["How much existing insulation needs to be removed? (m²)", "number"],
    ["Upload an overview photo of this ceiling area", "media"], ["Are there recessed downlights in this ceiling area?", "question"],
    ["How many recessed downlights?", "number"],
    ["Are there any issues that could affect the insulation installation?", "question"], ["Describe the issue and add a photo", "media"],
    ["How was this ceiling area measured?", "list"], ["Tell us how you measured it", "textsingle"],
    ["Upload your area sketch or floor plan.", "drawing"],
    ["Was the ceiling or roof built or replaced in the last 5 years?", "textsingle"], ["Anything else the office should know?", "textsingle"],
    ["I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.", "signature"],
    ["What's included in your quote?", "list"], ["What else is included?", "textsingle"], ["Total quoted price (inc GST)", "number"],
  ].map(([label, type]) => ({ label, type }));
  test("the real installer A1 template passes ready_check_priced", () => {
    const r = validateTemplate("ready_check_priced", A1);
    // Jo 8 Oct 2026 made the extras section required; this fixture was downloaded before it existed, so the ONLY gaps are the extras questions.
    expect(r.issues).toEqual(EXTRAS_MISSING);
  });
  test("the evidence-only form without pricing still fails the priced validator", () => {
    const r = validateTemplate("ready_check_priced", A1.filter((i) => !/quote|included/i.test(i.label)));
    expect(r.ok).toBe(false);
  });
  test("the real installer A1 answer labels feed the quote price reader", () => {
    const d = buildInstallerQuoteDraft({
      price: quotedPriceFromEntries([
        { label: "What\u2019s included in your quote?", value: "R5.0 ceiling insulation - supply & install" },
        { label: "Total quoted price (inc GST)", value: "$2,400" },
        { label: "What else is included?", value: null },
      ], false),
      measuredM2: 100, wholeVeec: { veecs: Math.floor(20), raw: Math.floor(20) * 70 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 },
    });
    expect(d.ready).toBe(true);
    expect(d.lines[0]?.unit_price_inc_gst).toBe(2400);
  });
});

describe("the real own-leads A2 template (HIVIC sourced, downloaded 2026-10-02)", () => {
  // Exact labels from the live Mitti definition (id dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39).
  // Multi-line help text after "\n" is what Mitti appends in the template editor.
  const A2 = [
    ["Portal Job Number", "textsingle"], ["Site address", "textsingle"], ["Inspection Date and Time", "datetime"],
    ["Homeowner name", "textsingle"], ["Property type", "textsingle"], ["Life support equipment at property?", "textsingle"],
    ["Was the ceiling or roof built or replaced in the last 5 years?", "textsingle"], ["Assessor", "textsingle"],
    ["Are the property details provided above correct?", "question"], ["What needs to be corrected?", "textsingle"],
    ["What type of roof does the home have? ", "question"], ["Describe the roof type", "textsingle"],
    ["How would you rate the ceiling access?", "question"], ["Upload a clear photo of the ceiling access point", "media"],
    ["How many ceiling areas need to be measured separately? \nCount areas separately where they have different roof/ceiling sections or need their own measurements. \nPRESS ON GREEN BOX BELOW TO ADD CEILING DETAILS. ", "list"],
    ["Which part of the home does this ceiling area cover?\ne.g. Main house \u2013 bedrooms and hallway", "textsingle"],
    ["How was this ceiling area measured?", "question"], ["Tell us how you measured it ", "textsingle"],
    ["Upload your area sketch or floor plan.\nRough is fine. Mark this ceiling area and show the measurements used.", "media"],
    ["Enter the measured ceiling area (m\u00b2)", "textsingle"],
    ["Is there existing insulation in this ceiling area?", "question"],
    ["What type of existing insulation is installed? Select all that apply", "list"],
    ["Please describe the existing insulation type ", "textsingle"],
    ["What is the measured insulation depth (mm)?", "textsingle"],
    ["Upload a photo clearly showing the measured insulation depth", "media"],
    ["What is required for the existing insulation?", "question"],
    ["How much existing insulation needs to be removed? (m\u00b2)", "textsingle"],
    ["Upload an overview photo of this ceiling area", "media"],
    ["Are there recessed downlights in this ceiling area?", "question"], ["How many recessed downlights?", "textsingle"],
    ["Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards", "question"],
    ["Describe the issue and add a photo", "media"],
    ["Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?", "question"],
    ["Why did the property fail the ready check? Select all that apply", "textsingle"],
    ["I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.", "signature"],
  ].map(([label, type]) => ({ label, type }));
  test("the real own-leads template passes the ready_check validator despite help-text lines", () => {
    expect(validateTemplate("ready_check", A2).issues).toEqual(EXTRAS_MISSING); // help-text lines cause no issues; only the 8 Oct extras section is absent
  });
  test("own-leads form has no pricing section and fails the priced validator with exactly the pricing issues", () => {
    const r = validateTemplate("ready_check_priced", A2);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([
      ...EXTRAS_MISSING, "Missing: What's included in your quote?", "Missing: What else is included?", "Missing: Total quoted price (inc GST)",
    ]);
  });
  test("A2 wording parses: per-area hazards flag, failed outcome and installer reasons", () => {
    const audit = {
      audit_id: "audit_a2", template_id: "template_a2real", modified_at: "2026-10-02T03:00:00Z",
      audit_data: { template_id: "template_a2real", date_completed: "2026-10-02T03:00:00Z", date_modified: "2026-10-02T03:00:00Z" },
      header_items: [],
      items: [
        { item_id: "ca", label: "Ceiling area", type: "dynamicfield" },
        { item_id: "a", parent_id: "ca", label: "Enter the measured ceiling area (m\u00b2)", type: "textsingle", responses: { text: "120" } },
        { item_id: "h", parent_id: "ca", label: "Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards", type: "question", responses: { text: "Yes" } },
        { item_id: "o", label: "Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?", type: "question", responses: { text: "No - Ready Check failed" } },
        { item_id: "r", label: "Why did the property fail the ready check? Select all that apply", type: "textsingle", responses: { text: "Asbestos suspected in the ceiling space" } },
      ],
    };
    const p = parseAudit(audit as never);
    expect(p.patch.measured_area_m2).toBe(120);
    expect(p.issues.some((i) => /Installer flagged hazards/.test(i))).toBe(true);
    expect(p.issues.some((i) => /Ready Check as failed/.test(i))).toBe(true);
    expect(p.patch.notes).toContain("installer reasons: Asbestos suspected in the ceiling space");
  });
});

describe("retired price items (Jo, 5 Oct)", () => {
  test("spec lists only R5.0 / Removal / Difficult access / Other; live template's Tile lift + Metal sheet still parse", async () => {
    const { PRICE_ITEMS, PRICING_FIELDS } = await import("../src/lib/mitti-forms.core");
    expect([...PRICE_ITEMS]).toEqual(["R5.0 supply and install", "Removal of existing insulation", "Difficult access", "Other"]);
    expect(PRICING_FIELDS[0]!.choices).not.toContain("Tile lift");
    expect(PRICING_FIELDS[0]!.choices).not.toContain("Metal sheet access");
    const p = quotedPriceFromEntries([
      { label: "What's included in your quote?", value: "R5.0 supply and install, Tile lift, Metal sheet access" },
      { label: "Total quoted price (inc GST)", value: "2400" },
      { label: "What else is included?", value: null },
    ], false);
    expect(p.issues).toEqual([]);
  });
});
