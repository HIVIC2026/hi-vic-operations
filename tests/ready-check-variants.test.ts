import { describe, expect, test } from "bun:test";
import { FORMS, PRICING_FIELDS, readyCheckVariant, validateQuotedPrice, validateTemplate, mittiAiPrompt } from "../src/lib/mitti-forms.core";
import { ownerPriceFromQuoted } from "../src/lib/installer-led.core";

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
    const items = FORMS.ready_check_priced.fields.map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type }));
    expect(validateTemplate("ready_check_priced", items).ok).toBe(true);
    const missingPricing = FORMS.ready_check.fields.map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type }));
    const result = validateTemplate("ready_check_priced", missingPricing);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("Total quoted price $"))).toBe(true);
  });

  test("AI prompt for the priced form uses tick-what's-included + one total and the draw option", () => {
    const prompt = mittiAiPrompt("ready_check_priced");
    expect(prompt).toContain("What's included in your price (tick all that apply)");
    expect(prompt).toContain('"Total quoted price $"');
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
    expect(validateQuotedPrice({ included: [R], totalIncGst: 1200, agreedWithOwner: null, removalRequired: false }).ok).toBe(false);
    expect(validateQuotedPrice({ included: [R], totalIncGst: 0, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
  });
  test("validated price feeds the owner co-branded quote without retyping", () => {
    const r = validateQuotedPrice({ included: [R], totalIncGst: 1200, agreedWithOwner: true, removalRequired: false });
    const owner = ownerPriceFromQuoted(r.price!, { piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 500 });
    expect(owner.total).toBe(1200 + 349 + 349);
  });
});
