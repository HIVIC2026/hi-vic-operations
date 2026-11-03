// Part 7 Task 1 (Jo 2 Nov 2026): the SWMS wording — "Lead Installer" in full, hazard 9 and the downlight safety step as
// approved, people labelled "(Lead Installer)" / "(Crew)", the "on site for the whole install" line under Compliance.
// The new set is used only while SWMS_NOV2_WORDING_ON is true (Part 11 flips it on a day with no real install within 48 h);
// while false everything a crew signed stays byte-identical to today, so nobody has to sign again before then.
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  SWMS_COMPLIANCE_MEASURES as EXPORTED_COMPLIANCE_MEASURES, SWMS_HAZARDS as EXPORTED_HAZARDS, SWMS_HOW_IMPLEMENTED as EXPORTED_HOW_IMPLEMENTED,
  SWMS_HOW_IN_PLACE as EXPORTED_HOW_IN_PLACE, SWMS_LEAD_ON_SITE_LINE, SWMS_NOV2_WORDING_ON, SWMS_REVIEW as EXPORTED_REVIEW, SWMS_RULE,
  SWMS_STANDARD_CONTROLS_TEXT, buildSwms, currentSignatures, swmsComplianceLines, swmsLeadPhoneBlocker, swmsPlanFingerprintText, swmsRecordText,
  swmsRoleLabel, swmsStatus, swmsWording, type SwmsFacts, type SwmsSignature,
} from "../src/lib/swms.core";
import { SWMS_HOUSE_STEPS, swmsHouseFacts, swmsHouseStepTexts, swmsHouseSteps } from "../src/lib/swms-house.core";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const swmsPlanSha = (plan: ReturnType<typeof buildSwms>) => sha(swmsPlanFingerprintText(plan));

/** The sample job of the approved SWMS (docs/approved-samples/2026-11-02/swms-web.html). */
const facts: SwmsFacts = {
  jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", businessName: "Rapid Insulation", installDate: "2026-11-13",
  lead: { name: "John Smith", workerId: "w1" }, crew: [{ name: "Sam Lee", workerId: "w2" }, { name: "Ali Khan", workerId: "w3" }],
  yearBuilt: 1975, hazardNote: "Old wiring in the hallway", siteNote: "Dog in yard",
  houseLines: ["Roof: Tile", "Ceiling access: Easy", "Main house: 4 recessed downlights", "PIESA: passed"],
  houseSteps: Object.values(SWMS_HOUSE_STEPS),
};
const sigs: SwmsSignature[] = [
  { key: "w:w1", name: "John Smith", typedName: "John Smith", signedAt: "2026-11-12T07:42:00Z" },
  { key: "w:w2", name: "Sam Lee", typedName: "Sam Lee", signedAt: "2026-11-12T08:05:00Z" },
];
const houseEntries = [
  { label: "How would you rate the ceiling access?", value: "Difficult" }, { label: "Which part of the home does this ceiling area cover?", value: "Main" },
  { label: "How many recessed downlights?", value: "4" }, { label: "Is the existing insulation foil-backed, metallic or electrically conductive?", value: "Yes" },
];
const houseExtras = { lifeSupportStatus: "yes", piesaOutcome: null, upgradesDone: false, piesaHazards: null };

// Computed from the base commit b62f5fd (before this task) with the facts above — see the report for the script. These pin
// "byte-identical to today" independently of the legacy constants kept in the code.
const TODAY = {
  rule: "swms-portal-2026-10-24",
  fingerprint: "9ce27eff74f4bc75c7b14c5baec8f5ced266d8584a3b8bf3a7738bceed26ac50",
  record: "4e122dd1da5fff1d8e3a0a04eb6fc2abd137c0092391e25a4bdcf85e865af9a4",
  standardControls: "d809ecde97f464bf5deeded2366c07749556a5e56d43899ddfc459a27c9279a4",
  howInPlace: "4c6e3aa2af3a86d7770bace580c2eed44dab9cd54160754e1f70a18afd88795c",
  houseSteps: "3ed5c3a0a85fdbc00f4f7d6434a3dff6c750da37f3af72463977a6d8916f707c",
};

describe("the approved 2 Nov wording (the SWMS_NOV2_WORDING_ON set)", () => {
  const { complianceMeasures: SWMS_COMPLIANCE_MEASURES, howImplemented: SWMS_HOW_IMPLEMENTED, review: SWMS_REVIEW, hazards: SWMS_HAZARDS } = swmsWording(true);
  const SWMS_HOUSE_STEPS_NOV2 = swmsHouseStepTexts(true);

  test("compliance, review and how-implemented lines say Lead Installer", () => {
    expect(SWMS_COMPLIANCE_MEASURES).toBe("Direct supervision by the Lead Installer; every control checked before first entry and at the start of each day");
    expect(SWMS_REVIEW).toBe("The Lead Installer re-checks every control at the start of each day before work, and the plan is reviewed if anything on site changes");
    expect(SWMS_HOW_IMPLEMENTED).toBe("Lead Installer directly supervises the crew, checks the control before anyone enters the ceiling and again at the start of each day, and stops work if it cannot be followed");
  });
  test("hazard 9 and the downlight safety step are the approved wording (non-breaking hyphen in IC‑4)", () => {
    expect(SWMS_HAZARDS[8]!.control).toBe("AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps and exhaust fans; downlights are IC or IC‑4 rated and insulated as rated; cables over 400 mm in insulation as the PIESA directs");
    expect(SWMS_HOUSE_STEPS_NOV2.downlights).toBe("Recessed downlights: every downlight is IC or IC‑4 rated (checked at the PIESA). Insulate over and around them as rated.");
    expect(SWMS_HAZARDS[8]!.control).toContain("IC‑4");
    expect(SWMS_HOUSE_STEPS_NOV2.downlights).toContain("IC‑4");
  });
  test("every control line starts with a capital; hazards 1–8 are today's sentences with the first letter capitalised, names and short names unchanged", () => {
    expect(SWMS_HAZARDS).toHaveLength(9);
    expect(SWMS_HAZARDS.every((h) => /^[A-Z]/.test(h.control))).toBe(true);
    const legacy = swmsWording(false).hazards;
    for (let i = 0; i < 8; i++) {
      expect(SWMS_HAZARDS[i]!.name).toBe(legacy[i]!.name);
      expect(SWMS_HAZARDS[i]!.short).toBe(legacy[i]!.short);
      expect(SWMS_HAZARDS[i]!.control).toBe(legacy[i]!.control.charAt(0).toUpperCase() + legacy[i]!.control.slice(1));
    }
    expect(SWMS_HAZARDS[8]!.name).toBe(legacy[8]!.name);
    expect(SWMS_HOUSE_STEPS_NOV2.foil).toBe(SWMS_HOUSE_STEPS.foil);
    expect(SWMS_HOUSE_STEPS_NOV2.lifeSupport).toBe(SWMS_HOUSE_STEPS.lifeSupport);
    expect(SWMS_HOUSE_STEPS_NOV2.difficultAccess).toBe(SWMS_HOUSE_STEPS.difficultAccess);
  });
  test("no lowercase 'lead installer' anywhere in the new set; people are labelled (Lead Installer) / (Crew)", () => {
    const w = swmsWording(true);
    const plan = buildSwms({ ...facts, houseSteps: swmsHouseSteps(swmsHouseFacts(houseEntries, houseExtras), true) }, { nov2: true });
    const strings = [
      w.rule, w.complianceMeasures, w.howImplemented, w.review, w.howInPlace, w.noLeadLine, w.leadPhoneOnlyLine, w.roleLabel.lead, w.roleLabel.crew,
      ...w.hazards.flatMap((h) => [h.name, h.short, h.control]), ...Object.values(swmsHouseStepTexts(true)), SWMS_LEAD_ON_SITE_LINE,
      swmsRecordText(plan, sigs), ...swmsStatus(buildSwms({ ...facts, lead: null, crew: [] }, { nov2: true }), []).missing,
      swmsLeadPhoneBlocker(plan, [], "w:w2", ["w:w3"]) ?? "", ...swmsComplianceLines(plan).flat(),
    ];
    for (const s of strings) expect(s, s).not.toMatch(/lead installer/);
    expect(w.roleLabel).toEqual({ lead: "Lead Installer", crew: "Crew" });
    expect(swmsRoleLabel(plan.rule, "lead")).toBe("Lead Installer");
    expect(swmsRoleLabel(plan.rule, "crew")).toBe("Crew");
    const txt = swmsRecordText(plan, sigs);
    expect(txt).toContain("John Smith (Lead Installer) | signed — typed \"John Smith\" | 2026-11-12T07:42:00Z");
    expect(txt).toContain("Sam Lee (Crew) | signed — typed \"Sam Lee\" | 2026-11-12T08:05:00Z");
    expect(txt).toContain("Ali Khan (Crew) | NOT SIGNED | —");
    expect(txt).toContain(`| ${w.howImplemented} | John Smith (Lead Installer)`);
    expect(txt).toContain(`Measures to ensure compliance: ${w.complianceMeasures}`);
    expect(txt).toContain(`How control measures will be reviewed: ${w.review}`);
    expect(txt).toContain(w.howInPlace);
    expect(swmsLeadPhoneBlocker(plan, [], "w:w2", ["w:w3"])).toBe("Only the Lead Installer can open someone's sign link on their phone.");
    expect(swmsStatus(buildSwms({ ...facts, lead: null, crew: [] }, { nov2: true }), []).missing).toEqual(["No Lead Installer is chosen for this install"]);
  });
  test("the on-site line is approved wording and always sits under Compliance", () => {
    expect(SWMS_LEAD_ON_SITE_LINE).toBe("The Lead Installer is on site for the whole install.");
    for (const nov2 of [false, true]) {
      const lines = swmsComplianceLines(buildSwms(facts, { nov2 }));
      expect(lines.some(([, v]) => v === SWMS_LEAD_ON_SITE_LINE)).toBe(true);
      expect(lines.map(([l]) => l).slice(0, 3)).toEqual(["Person responsible for ensuring compliance with SWMS", "Measures to ensure compliance", "How control measures will be reviewed"]);
      expect(lines[0]![1]).toBe("John Smith");
      expect(lines[1]![1]).toBe(swmsWording(nov2).complianceMeasures);
      expect(lines[2]![1]).toBe(swmsWording(nov2).review);
    }
    expect(swmsComplianceLines(buildSwms({ ...facts, lead: null }))[0]![1]).toBe("—");
  });
});

describe("SWMS_NOV2_WORDING_ON is false: everything stays byte-identical to today", () => {
  test("the flag is off in the code and the module exports are the legacy set", () => {
    expect(SWMS_NOV2_WORDING_ON).toBe(false);
    const legacy = swmsWording(false);
    expect(swmsWording()).toBe(legacy);
    expect(SWMS_RULE).toBe(TODAY.rule);
    expect(legacy.rule).toBe(TODAY.rule);
    expect(EXPORTED_COMPLIANCE_MEASURES).toBe(legacy.complianceMeasures);
    expect(EXPORTED_HOW_IMPLEMENTED).toBe(legacy.howImplemented);
    expect(EXPORTED_REVIEW).toBe(legacy.review);
    expect(EXPORTED_HOW_IN_PLACE).toBe(legacy.howInPlace);
    expect(EXPORTED_HAZARDS).toBe(legacy.hazards);
    expect(SWMS_HOUSE_STEPS).toBe(swmsHouseStepTexts(false));
    expect(legacy.roleLabel).toEqual({ lead: "lead installer", crew: "installer" });
  });
  test("plan fingerprint, filed record text, standard-controls paragraph and house steps hash exactly as on the base commit", () => {
    const plan = buildSwms(facts);
    expect(plan.rule).toBe(TODAY.rule);
    expect(swmsPlanSha(plan)).toBe(TODAY.fingerprint);
    expect(sha(swmsRecordText(plan, sigs))).toBe(TODAY.record);
    expect(sha(SWMS_STANDARD_CONTROLS_TEXT)).toBe(TODAY.standardControls);
    expect(sha(EXPORTED_HOW_IN_PLACE)).toBe(TODAY.howInPlace);
    expect(sha(JSON.stringify(swmsHouseSteps(swmsHouseFacts(houseEntries, houseExtras))))).toBe(TODAY.houseSteps);
    expect(swmsRecordText(plan, sigs)).toContain("John Smith (lead installer) | signed");
    expect(swmsStatus(buildSwms({ ...facts, lead: null, crew: [] }), []).missing).toEqual(["No lead installer is chosen for this install"]);
    expect(swmsLeadPhoneBlocker(plan, [], "w:w2", ["w:w3"])).toBe("Only the lead installer can open someone's sign link on their phone.");
  });
});

describe("switched on: the rule and fingerprint change, so a signature on the old wording no longer counts", () => {
  test("rule swms-portal-2026-11-02; old signatures are filtered out by currentSignatures and every person is missing again", () => {
    const oldPlan = buildSwms(facts);
    const newPlan = buildSwms(facts, { nov2: true });
    expect(newPlan.rule).toBe("swms-portal-2026-11-02");
    expect(swmsWording(true).rule).toBe("swms-portal-2026-11-02");
    expect(swmsPlanSha(newPlan)).not.toBe(swmsPlanSha(oldPlan));
    expect(swmsPlanFingerprintText(newPlan)).toContain("IC‑4");
    const oldSigs = sigs.map((s) => ({ ...s, planSha: swmsPlanSha(oldPlan) }));
    expect(currentSignatures(oldSigs, swmsPlanSha(oldPlan))).toHaveLength(2);
    expect(currentSignatures(oldSigs, swmsPlanSha(newPlan))).toEqual([]);
    expect(swmsStatus(newPlan, currentSignatures(oldSigs, swmsPlanSha(newPlan))).missing).toEqual(["John Smith", "Sam Lee", "Ali Khan"]);
    // The downlight step from the house facts changes with the flag too (it is part of the fingerprint).
    expect(swmsHouseSteps(swmsHouseFacts(houseEntries, houseExtras), true)).toContain(swmsHouseStepTexts(true).downlights);
    expect(swmsHouseSteps(swmsHouseFacts(houseEntries, houseExtras), true)).not.toContain(SWMS_HOUSE_STEPS.downlights);
  });
});
