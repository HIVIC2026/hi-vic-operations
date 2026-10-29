import { describe, expect, test } from "bun:test";
import { swmsHouseFacts, swmsHouseLines, swmsHouseSteps, SWMS_HOUSE_STEPS } from "../src/lib/swms-house.core";

const e = (label: string, value: string | null) => ({ label, value });
const FULL = [
  e("Life support equipment at property?", "Yes"),
  e("Was the ceiling or roof built or replaced in the last 5 years?", "Yes"),
  e("What type of roof does the home have?", "Tiles"),
  e("How would you rate the ceiling access?", "Difficult"),
  e("Which part of the home does this ceiling area cover?", "Kitchen"),
  e("Length (m)", "4"),
  e("Is the existing insulation foil-backed, metallic or electrically conductive?", "Yes"),
  e("Are there recessed downlights in this ceiling area?", "Yes"),
  e("How many recessed downlights?", "6"),
  e("Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards", "Yes"),
  e("What is the issue, and where is it in this area?", "Exposed wiring near the manhole"),
  e("Which part of the home does this ceiling area cover?", "Bedrooms"),
  e("Is the existing insulation foil-backed, metallic or electrically conductive?", "No"),
  e("Are there recessed downlights in this ceiling area?", "No"),
];

describe("SWMS house facts", () => {
  test("a full Ready Check and PIESA give every line in order", () => {
    const f = swmsHouseFacts(FULL, { lifeSupportStatus: null, piesaOutcome: "fail", upgradesDone: false, piesaHazards: "Old wiring in the hallway" });
    expect(swmsHouseLines(f)).toEqual([
      "Roof: Tiles",
      "Ceiling access: Difficult",
      "Life support equipment at the property",
      "Ceiling or roof built or replaced in the last 5 years",
      "Kitchen: foil-backed or conductive existing insulation",
      "Kitchen: 6 recessed downlights",
      "Ready Check issue (Kitchen): Exposed wiring near the manhole",
      "PIESA: electrical upgrades needed (not done yet)",
      "PIESA hazards: Old wiring in the hallway",
    ]);
    expect(swmsHouseSteps(f)).toEqual([SWMS_HOUSE_STEPS.foil, SWMS_HOUSE_STEPS.lifeSupport, SWMS_HOUSE_STEPS.difficultAccess, SWMS_HOUSE_STEPS.downlights]);
  });

  test("nothing known gives no lines and no steps", () => {
    const f = swmsHouseFacts([], { lifeSupportStatus: null, piesaOutcome: null, upgradesDone: false, piesaHazards: null });
    expect(swmsHouseLines(f)).toEqual([]);
    expect(swmsHouseSteps(f)).toEqual([]);
  });

  test("each safety step appears only when its fact is true", () => {
    const none = { lifeSupportStatus: null, piesaOutcome: null, upgradesDone: false, piesaHazards: null };
    const only = (entries: { label: string; value: string | null }[], extra = none) => swmsHouseSteps(swmsHouseFacts(entries, extra));
    expect(only([e("How would you rate the ceiling access?", "Standard")])).toEqual([]);
    expect(only([e("How would you rate the ceiling access?", "Difficult")])).toEqual([SWMS_HOUSE_STEPS.difficultAccess]);
    expect(only([], { ...none, lifeSupportStatus: "yes" })).toEqual([SWMS_HOUSE_STEPS.lifeSupport]);
    expect(only([e("Which part of the home does this ceiling area cover?", "Loft"), e("Is the existing insulation foil-backed, metallic or electrically conductive?", "Yes")])).toEqual([SWMS_HOUSE_STEPS.foil]);
    expect(only([e("Which part of the home does this ceiling area cover?", "Loft"), e("How many recessed downlights?", "2")])).toEqual([SWMS_HOUSE_STEPS.downlights]);
  });

  test("PIESA pass and done upgrades read plainly", () => {
    const base = { lifeSupportStatus: null, piesaHazards: null };
    expect(swmsHouseLines(swmsHouseFacts([], { ...base, piesaOutcome: "pass", upgradesDone: false }))).toEqual(["PIESA: passed"]);
    expect(swmsHouseLines(swmsHouseFacts([], { ...base, piesaOutcome: "fail", upgradesDone: true }))).toEqual(["PIESA: electrical upgrades needed (done)"]);
  });

  test("old form labels still read", () => {
    const f = swmsHouseFacts([
      e("Roof type", "Metal sheet"), e("How easy is the ceiling access?", "Easy"),
      e("Where is this area?", "Lounge"), e("Recessed downlights in this area?", "Yes"), e("How many?", "3"),
      e("Hazards in this area?", "Yes"), e("Please explain", "Wasp nest"),
    ], { lifeSupportStatus: null, piesaOutcome: null, upgradesDone: false, piesaHazards: null });
    expect(swmsHouseLines(f)).toEqual(["Roof: Metal sheet", "Ceiling access: Easy", "Lounge: 3 recessed downlights", "Ready Check issue (Lounge): Wasp nest"]);
  });
});

describe("SWMS plan carries the house section", () => {
  test("record text lists facts, then safety steps, then the installer's note", async () => {
    const { buildSwms, swmsRecordText, swmsHouseSection } = await import("../src/lib/swms.core");
    const base = { jobNumber: "HV-TEST-1", address: null, businessName: null, installDate: null, lead: { name: "TEST Lead", workerId: "w1" }, crew: [], yearBuilt: 2000, hazardNote: null };
    const plan = buildSwms({ ...base, siteNote: "Dog in yard", houseLines: ["Roof: Tiles"], houseSteps: [SWMS_HOUSE_STEPS.downlights] });
    expect(swmsHouseSection(plan)).toEqual(["Roof: Tiles", `Safety step: ${SWMS_HOUSE_STEPS.downlights}`, "Dog in yard"]);
    expect(swmsRecordText(plan, [])).toContain(`Specific to this house:\n- Roof: Tiles\n- Safety step: ${SWMS_HOUSE_STEPS.downlights}\n- Dog in yard`);
    expect(swmsRecordText(buildSwms({ ...base, siteNote: null }), [])).toContain("Specific to this house: None recorded");
  });
});

describe("signatures count only for the version signed (Jo 30 Oct 2026)", () => {
  test("a changed plan needs signing again; a new crew member doesn't void the others", async () => {
    const { createHash } = await import("node:crypto");
    const { buildSwms, checkSwmsSign, currentSignatures, swmsPlanFingerprintText, swmsStatus } = await import("../src/lib/swms.core");
    const sha = (p: Parameters<typeof swmsPlanFingerprintText>[0]) => createHash("sha256").update(swmsPlanFingerprintText(p)).digest("hex");
    const base = { jobNumber: "HV-TEST-2", address: null, businessName: null, installDate: null, lead: { name: "TEST Lead", workerId: "w1" }, crew: [], yearBuilt: 2000, hazardNote: null, siteNote: null };
    const v1 = buildSwms(base);
    const signed = [{ key: "w:w1", name: "TEST Lead", typedName: "TEST Lead", signedAt: "2026-11-01T00:00:00Z", planSha: sha(v1) }];
    expect(swmsStatus(v1, currentSignatures(signed, sha(v1))).complete).toBe(true);

    const v2 = buildSwms({ ...base, houseLines: ["PIESA: passed"] });
    const now = currentSignatures(signed, sha(v2));
    expect(swmsStatus(v2, now).missing).toEqual(["TEST Lead"]);
    expect(checkSwmsSign(v2, now, "w:w1", "TEST Lead").ok).toBe(true);

    const withCrew = buildSwms({ ...base, crew: [{ name: "TEST Crew", workerId: "w2" }] });
    expect(sha(withCrew)).toBe(sha(v1));
    expect(swmsStatus(withCrew, currentSignatures(signed, sha(withCrew))).missing).toEqual(["TEST Crew"]);
  });
});

describe("real TEST job Ready Check answers (HV-3197, HV-1351 shapes)", () => {
  const none = { lifeSupportStatus: null, piesaOutcome: null, upgradesDone: false, piesaHazards: null };
  const area = "Which part of the home does this ceiling area cover?\ne.g. Main house – bedrooms and hallway";
  test("difficult access with its note, empty template area ignored", () => {
    const f = swmsHouseFacts([
      e("Life support equipment at property?", "No"), e("Was the ceiling or roof built or replaced in the last 5 years?", "No"),
      e("What type of roof does the home have? ", "Metal sheet"), e("How would you rate the ceiling access?", "Difficult"),
      e("Please explain why the access is difficult", "Just is"),
      e("CLICK ON ME to add a ceiling area", null), e(area, null), e("Are there recessed downlights in this ceiling area?", null),
      e("── Ceiling Area 1 ──", null), e(area, "Main"), e("Are there recessed downlights in this ceiling area?", "No"),
      e("Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards", "No"),
    ], none);
    expect(swmsHouseLines(f)).toEqual(["Roof: Metal sheet", "Ceiling access: Difficult", "Access note: Just is"]);
    expect(swmsHouseSteps(f)).toEqual([SWMS_HOUSE_STEPS.difficultAccess]);
  });
  test("office placeholder for life support is not read as yes", () => {
    const f = swmsHouseFacts([e("Life support equipment at property?", "None recorded by office"), e("What type of roof does the home have? ", "Tiles"), e("How would you rate the ceiling access?", "Easy")], { ...none, lifeSupportStatus: "no" });
    expect(swmsHouseLines(f)).toEqual(["Roof: Tiles", "Ceiling access: Easy"]);
    expect(swmsHouseSteps(f)).toEqual([]);
  });
});
