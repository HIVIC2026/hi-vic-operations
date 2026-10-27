import { describe, expect, it } from "bun:test";
import { installerLedOwnerPrice, piesaChargeIncGst, readyCheckCoverage, installerNextAction } from "../src/lib/installer-led.core";
import { FORMS, validateTemplate, flattenDefinition, PIESA_OUTCOMES } from "../src/lib/mitti-forms.core";
import { jobMargin } from "../src/lib/profit.core";

describe("installer-led pricing", () => {
  it("HIV-arranged electrician carries the $349 PIESA; own electrician's price comes from the Ready Check (Jo, 26 Oct)", () => {
    expect(piesaChargeIncGst("hivic_matched", 349)).toBe(349);
    expect(piesaChargeIncGst("hivic_organise", 349)).toBe(349);
    expect(piesaChargeIncGst("hivic_matched", null)).toBeNull(); // no settings price = no charge (office quotes)
    expect(piesaChargeIncGst("installer_own", 349)).toBeNull();
    expect(piesaChargeIncGst("preferred", 349)).toBeNull();
    expect(piesaChargeIncGst("nominated", 349)).toBeNull();

    expect(piesaChargeIncGst(null, 280)).toBeNull();
  });
  it("owner price = quote + PIESA + rectification + AP fee − discount, no referral, min $200", () => {
    const p = installerLedOwnerPrice({ installerQuoteIncGst: 3000, piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 200, veecDiscountIncGst: 2100 });
    expect(p.total).toBe(3549); expect(p.afterDiscount).toBe(1449); expect("referralFee" in p).toBe(false); expect(p.ready).toBe(true);
    expect(installerLedOwnerPrice({ installerQuoteIncGst: 1000, piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 0, veecDiscountIncGst: 1200 }).afterDiscount).toBe(200); // discount reduced to keep the $200 minimum (not blocked)
    expect(installerLedOwnerPrice({ installerQuoteIncGst: 3000, piesaIncGst: null, rectificationIncGst: 0, apFeeIncGst: null, veecDiscountIncGst: 0 }).blockers.length).toBe(2);
  });
  it("installer-led jobs never carry a referral fee in profit", () => {
    const base = { installerCostExGst: 1000, installerMarginExGst: 0, apFeeExGst: 317.27, electricalCostExGst: 0, electricalChargeExGst: 0, installerSourced: true, veecDiscountIncGst: 700, piesaRecCostExGst: null, veecLodgementFeeExGst: null };
    expect("referralFeeEx" in jobMargin({ ...base, installerLed: true }, 85)).toBe(false);
    expect(jobMargin(base, 85).tradeMargin).toBe(jobMargin({ ...base, installerLed: true }, 85).tradeMargin);
  });
});

describe("Ready Check coverage", () => {
  const full = { installerIdPhoto: true, buildingClass: "Class 1", builtLast5Years: false, floorPlan: true, icObservation: true, areas: [{ name: "Main", state: "Under-insulated" as const, depthPhoto: true, rValue: 1.2, removal: false, m2: 120, beforeVideo: true }] };
  it("complete evidence needs no extra visit", () => expect(readyCheckCoverage(full).status).toBe("complete"));
  it("partial lists only the missing items", () => {
    const c = readyCheckCoverage({ ...full, areas: [{ ...full.areas[0], depthPhoto: false }] });
    expect(c.status).toBe("partial"); expect(c.missing).toEqual(["Main: depth photo with vertical ruler"]);
  });
  it("below-R2.0 confirmation tick replaces the depth photo and R-value (Jo 8 Oct 2026)", () => {
    const c = readyCheckCoverage({ ...full, areas: [{ ...full.areas[0], depthPhoto: false, rValue: null, belowR2Confirmed: true }] });
    expect(c.status).toBe("complete"); expect(c.missing).toEqual([]);
  });
  it("the tick does not rescue a measured R2.0+ area", () => {
    const c = readyCheckCoverage({ ...full, areas: [{ ...full.areas[0], depthPhoto: false, rValue: 2.5, belowR2Confirmed: true }] });
    expect(c.hardFail.length).toBe(1);
  });
  it("nothing supplied → book Ready Check", () => {
    const c = readyCheckCoverage({ areas: [] });
    expect(c.status).toBe("none");
    expect(installerNextAction({ eligible: true, coverage: c, electrician: null, electricianApproved: false })).toContain("Ready Check");
  });
  it("R2.0+ or built in last 5 years hard-fails", () => {
    expect(readyCheckCoverage({ ...full, areas: [{ ...full.areas[0], rValue: 2.5 }] }).hardFail.length).toBe(1);
    expect(readyCheckCoverage({ ...full, builtLast5Years: true }).hardFail.length).toBe(1);
  });
  it("own electrician must be approved first", () => {
    expect(installerNextAction({ eligible: true, coverage: readyCheckCoverage(full), electrician: "installer_own", electricianApproved: false })).toContain("onboarding");
    expect(installerNextAction({ eligible: true, coverage: readyCheckCoverage(full), electrician: "hivic_matched", electricianApproved: false })).toContain("PIESA");
  });
});

describe("Mitti form validation", () => {
  const typeFor = (t: string) => ({ text: "textsingle", phone: "textsingle", number: "textsingle", choice: "question", multichoice: "question", yesno: "question", media: "media", signature: "signature", datetime: "datetime", date: "datetime", tick: "checkbox" } as Record<string, string>)[t];
  const complete = (k: "ready_check" | "piesa" | "piisa") => FORMS[k].fields.filter((f) => !f.statement).map((f) => ({ label: f.label, type: typeFor(f.type) }));
  for (const k of ["ready_check", "piesa", "piisa"] as const) it(`${k}: full form passes`, () => expect(validateTemplate(k, complete(k))).toEqual({ ok: true, issues: [] }));
  it("missing, duplicate and wrong-type fields fail closed", () => {
    const items = complete("piesa");
    expect(validateTemplate("piesa", items.slice(1)).ok).toBe(false);
    expect(validateTemplate("piesa", [...items, items[5]]).issues.some((i) => i.startsWith("Duplicate"))).toBe(true);
    expect(validateTemplate("piesa", items.map((i, n) => n === 3 ? { ...i, type: "media" } : i)).issues[0]).toContain("Wrong type");
  });
  it("installer forms cannot carry PIESA outcome", () => {
    expect(validateTemplate("ready_check", [...complete("ready_check"), { label: "B1 Assessment outcome", type: "question" }]).ok).toBe(false);
  });
  it("uses the exact official B1 options", () => expect(PIESA_OUTCOMES[0]).toBe("Electrical rectification work is not required before insulation is installed or upgraded."));
  it("flattens a v1 template definition", () => {
    const def = { template: { items: [{ label: "Page", section: {}, children: [{ label: "Portal Job Number", textsingle: {} }, { label: "Photo", media: {} }] }] } };
    expect(flattenDefinition(def)).toEqual([{ label: "Portal Job Number", type: "textsingle" }, { label: "Photo", type: "media" }]);
  });
});
