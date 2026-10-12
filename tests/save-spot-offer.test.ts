import { describe, expect, test } from "bun:test";
import { BUTTON_CALCULATOR, BUTTON_ORIGINAL, SAVE_SPOT_NOT_SURE, SPOT_SAVED_HEADING, calculatorInsulation, demandParagraph, originalEstimateBlocker, pickSaveSpotVariant, renderSaveSpotOfferEmail, saveSpotLinks, saveSpotPriceLines, type SaveSpotOfferFacts } from "../src/lib/save-spot-offer.core";
import { SAVE_SPOT_INSTRUCTION } from "../src/lib/estimate-email";

const T = "A".repeat(43);
const links = saveSpotLinks(T);
const base: SaveSpotOfferFacts = {
  variant: "no_insulation_owner_size", assumedArea: false, address: "30 Dash St, Fraser Rise VIC 3336", areaM2: 120, firstName: "Sam", reference: "HV-1",
  installation: 3600, assessmentFee: 349, apFee: 349, gross: 4298, discount: 1470, customer: 2828, removal: { kind: "excluded" }, apCount: 2,
  ...links, unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`, referralUrl: null,
};

describe("variant selection", () => {
  test("owner size vs assumed size", () => {
    expect(pickSaveSpotVariant({ route: "offer_spot", insulation: "none", mediaReview: null, criteriaPassed: false, areaAssumed: false })).toEqual({ variant: "no_insulation_owner_size", assumedArea: false });
    expect(pickSaveSpotVariant({ route: "offer_spot", insulation: "none", mediaReview: null, criteriaPassed: false, areaAssumed: true })).toEqual({ variant: "no_insulation_assumed_size", assumedArea: true });
  });
  test("reviewed variant only from recorded below-R2 review", () => {
    expect("blocked" in pickSaveSpotVariant({ route: "request_insulation", insulation: "present", mediaReview: null, criteriaPassed: true, areaAssumed: false })).toBe(true);
    expect("blocked" in pickSaveSpotVariant({ route: "request_insulation", insulation: "present", mediaReview: "over_r2", criteriaPassed: true, areaAssumed: false })).toBe(true);
    expect("blocked" in pickSaveSpotVariant({ route: "request_insulation", insulation: "none", mediaReview: "below_r2", criteriaPassed: true, areaAssumed: false })).toBe(true);
    expect(pickSaveSpotVariant({ route: "request_insulation", insulation: "present", mediaReview: "below_r2", criteriaPassed: true, areaAssumed: true })).toEqual({ variant: "reviewed_under_r2", assumedArea: true });
  });
});

describe("email", () => {
  test("variant 1 intro, breakdown and both links", () => {
    const e = renderSaveSpotOfferEmail(base);
    expect(e.plainText).toContain("We’ve used your supplied ceiling area of 120 m² to prepare the preliminary estimate below.");
    expect(e.plainText).toContain(`${BUTTON_ORIGINAL}: https://estimate.homeinsulationvictoria.com.au/estimate/${T}/calculator?keep=original`);
    expect(e.plainText).toContain(`${BUTTON_CALCULATOR}: https://estimate.homeinsulationvictoria.com.au/estimate/${T}/calculator`);
    for (const t of ["Free Ready Check", "$3,600", "$349", "$4,298", "−$1,470", "$2,828"]) expect(e.plainText).toContain(t);
    expect(e.html).toContain("v:roundrect");
    expect((e.html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(e.plainText).toContain("Unsubscribe:");
    expect(e.plainText).toContain(SAVE_SPOT_INSTRUCTION);
    expect(e.plainText).not.toContain("$15 per m²");
  });
  test("variant 2 labels the assumption", () => {
    const e = renderSaveSpotOfferEmail({ ...base, variant: "no_insulation_assumed_size", assumedArea: true, areaM2: 150, installation: 4500, gross: 5198, customer: 3728 });
    expect(e.plainText).toContain("we’ve used an assumed area of 150 m²");
    expect(e.plainText).toContain("This is an assumed size, not a measurement.");
    expect(e.plainText).toContain(SAVE_SPOT_NOT_SURE);
    expect(() => renderSaveSpotOfferEmail({ ...base, variant: "no_insulation_assumed_size", assumedArea: true })).toThrow();
  });
  test("variant 3: $15/m² removal note only when not itemised; itemised removal shown not excluded", () => {
    const v3 = { ...base, variant: "reviewed_under_r2" as const };
    expect(renderSaveSpotOfferEmail(v3).plainText).toContain("budget an additional $15 per m², including GST, only for the areas that need removal");
    const inc = renderSaveSpotOfferEmail({ ...v3, removal: { kind: "included", amount: 300, areaM2: 20 }, gross: 4598, customer: 3128 });
    expect(inc.plainText).toContain("Existing insulation removal (20 m²)");
    expect(inc.plainText).not.toContain("$15 per m²");
  });
  test("arithmetic must add up", () => {
    expect(() => saveSpotPriceLines({ ...base, gross: 4300 })).toThrow();
    expect(() => saveSpotPriceLines({ ...base, customer: 2800 })).toThrow();
  });
  test("links must be the job's token on the customer domain", () => {
    expect(() => saveSpotLinks("short")).toThrow();
    expect(() => saveSpotLinks(T, "https://id-preview--x.lovable.app")).toThrow();
  });
  test("AP count guard", () => {
    expect(demandParagraph(2)).toBe(SAVE_SPOT_INSTRUCTION);
    expect(() => demandParagraph(0)).toThrow();
  });
});

describe("calculator choice", () => {
  const est = { area_m2: 150, area_source: "typical_default", insulation_declared: "none", hasPrice: true };
  test("original recoverable or fails clearly", () => {
    expect(originalEstimateBlocker({ estimate: est, ownerAreaKnown: false, reviewedUnderR2: false })).toBeNull();
    expect(originalEstimateBlocker({ estimate: null, ownerAreaKnown: false, reviewedUnderR2: false })).toContain("couldn’t find the original estimate");
    expect(originalEstimateBlocker({ estimate: est, ownerAreaKnown: true, reviewedUnderR2: false })).not.toBeNull();
    expect(originalEstimateBlocker({ estimate: { ...est, insulation_declared: "present" }, ownerAreaKnown: false, reviewedUnderR2: false })).not.toBeNull();
    expect(originalEstimateBlocker({ estimate: { ...est, insulation_declared: "present" }, ownerAreaKnown: false, reviewedUnderR2: true })).toBeNull();
  });
  test("calculator never changes recorded insulation", () => {
    expect(calculatorInsulation("present")).toBe("present");
    expect(calculatorInsulation("none")).toBe("none");
  });
  test("success heading", () => expect(SPOT_SAVED_HEADING).toBe("Your spot has been saved"));
});
