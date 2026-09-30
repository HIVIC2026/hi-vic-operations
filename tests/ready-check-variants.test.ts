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

  test("priced variant validates against a matching template; evidence-only template fails it", () => {
    const items = FORMS.ready_check_priced.fields.map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type }));
    expect(validateTemplate("ready_check_priced", items).ok).toBe(true);
    const missingPricing = FORMS.ready_check.fields.map((f) => ({ label: f.label, type: f.type === "choice" ? "question" : f.type === "multichoice" ? "checkbox" : f.type === "yesno" ? "question" : f.type === "media" ? "media" : f.type }));
    const result = validateTemplate("ready_check_priced", missingPricing);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("Total quoted price incl GST $"))).toBe(true);
  });

  test("AI prompt for the priced form includes the Quoted price line repeat section", () => {
    const prompt = mittiAiPrompt("ready_check_priced");
    expect(prompt).toContain('"Quoted price line"');
    expect(prompt).toContain('"Total quoted price incl GST $"');
    expect(prompt).toContain('"Price already agreed with the owner?"');
    expect(mittiAiPrompt("ready_check")).not.toContain("Quoted price line");
  });
});

describe("validateQuotedPrice", () => {
  const goodLine = { description: "Supply and install ceiling insulation", quantity: 100, unit: "m2", unitPriceIncGst: 12 };

  test("accepts a consistent quote and computes line totals", () => {
    const r = validateQuotedPrice({ lines: [goodLine], totalIncGst: 1200, includes: "Removal and tile lift", agreedWithOwner: true });
    expect(r.ok).toBe(true);
    expect(r.price?.lines[0].lineTotalIncGst).toBe(1200);
    expect(r.price?.agreedWithOwner).toBe(true);
  });

  test("flags a total that does not match the lines — never trusts either figure", () => {
    const r = validateQuotedPrice({ lines: [goodLine], totalIncGst: 900, includes: "x", agreedWithOwner: false });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain("does not equal the sum of the lines");
    expect(r.price).toBeNull();
  });

  test("fails closed on missing lines, bad unit, missing includes or unanswered agreement", () => {
    expect(validateQuotedPrice({ lines: [], totalIncGst: 100, includes: "x", agreedWithOwner: true }).ok).toBe(false);
    expect(validateQuotedPrice({ lines: [{ ...goodLine, unit: "sqm" }], totalIncGst: 1200, includes: "x", agreedWithOwner: true }).ok).toBe(false);
    expect(validateQuotedPrice({ lines: [goodLine], totalIncGst: 1200, includes: " ", agreedWithOwner: true }).ok).toBe(false);
    expect(validateQuotedPrice({ lines: [goodLine], totalIncGst: 1200, includes: "x", agreedWithOwner: null }).ok).toBe(false);
  });

  test("validated price feeds the owner co-branded quote without retyping", () => {
    const r = validateQuotedPrice({ lines: [goodLine], totalIncGst: 1200, includes: "all", agreedWithOwner: true });
    const owner = ownerPriceFromQuoted(r.price!, { piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 500 });
    expect(owner.ready).toBe(true);
    expect(owner.total).toBe(1200 + 349 + 349);
    expect(owner.afterDiscount).toBe(1200 + 349 + 349 - 500);
  });
});
