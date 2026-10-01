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

  test("AI prompt for the priced form includes the Quoted price line repeat section and the draw option", () => {
    const prompt = mittiAiPrompt("ready_check_priced");
    expect(prompt).toContain('"Quoted price line"');
    expect(prompt).toContain('"Total quoted price $"');
    expect(prompt).toContain('"Price already agreed with the owner?"');
    expect(prompt).toContain("DRAW the diagram inside the form");
    expect(mittiAiPrompt("ready_check")).not.toContain("Quoted price line");
  });
});

describe("validateQuotedPrice", () => {
  const r50 = { item: "R5.0 supply and install", description: "", priceIncGst: 1200 };
  const removal = { item: "Removal of existing insulation", description: "", priceIncGst: 400 };

  test("accepts a consistent quote", () => {
    const r = validateQuotedPrice({ lines: [r50, removal], totalIncGst: 1600, agreedWithOwner: true, removalRequired: true });
    expect(r.ok).toBe(true);
    expect(r.price?.lines).toHaveLength(2);
    expect(r.price?.agreedWithOwner).toBe(true);
  });

  test("flags a total that does not match the lines — never trusts either figure", () => {
    const r = validateQuotedPrice({ lines: [r50], totalIncGst: 900, agreedWithOwner: false, removalRequired: false });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain("does not equal the sum of the lines");
    expect(r.price).toBeNull();
  });

  test("requires exactly one R5.0 line", () => {
    expect(validateQuotedPrice({ lines: [removal], totalIncGst: 400, agreedWithOwner: true, removalRequired: true }).ok).toBe(false);
    expect(validateQuotedPrice({ lines: [r50, r50], totalIncGst: 2400, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
  });

  test("removal line required when an area says Remove; not allowed when none do", () => {
    const missing = validateQuotedPrice({ lines: [r50], totalIncGst: 1200, agreedWithOwner: true, removalRequired: true });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((i) => i.includes("Removal of existing insulation"))).toBe(true);
    const extra = validateQuotedPrice({ lines: [r50, removal], totalIncGst: 1600, agreedWithOwner: true, removalRequired: false });
    expect(extra.ok).toBe(false);
  });

  test("Other lines need a description; fails closed on missing answers", () => {
    expect(validateQuotedPrice({ lines: [r50, { item: "Other", description: "", priceIncGst: 100 }], totalIncGst: 1300, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
    expect(validateQuotedPrice({ lines: [r50, { item: "Other", description: "Asbestos check", priceIncGst: 100 }], totalIncGst: 1300, agreedWithOwner: true, removalRequired: false }).ok).toBe(true);
    expect(validateQuotedPrice({ lines: [r50], totalIncGst: 1200, agreedWithOwner: null, removalRequired: false }).ok).toBe(false);
    expect(validateQuotedPrice({ lines: [], totalIncGst: 100, agreedWithOwner: true, removalRequired: false }).ok).toBe(false);
  });

  test("validated price feeds the owner co-branded quote without retyping", () => {
    const r = validateQuotedPrice({ lines: [r50], totalIncGst: 1200, agreedWithOwner: true, removalRequired: false });
    const owner = ownerPriceFromQuoted(r.price!, { piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 500 });
    expect(owner.ready).toBe(true);
    expect(owner.total).toBe(1200 + 349 + 349);
    expect(owner.afterDiscount).toBe(1200 + 349 + 349 - 500);
  });
});
