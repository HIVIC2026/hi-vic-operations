import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { renderStep3SaveSpot, STEP3_SAVESPOT_SAMPLE as S } from "../src/lib/step3-emails";
import { renderLaunchCampaignEmail } from "../src/lib/estimate-email";
import { REMOVAL_BUDGET_EMAIL_NOTE, REMOVAL_EXCLUDED, removalFromScenario, removalNote } from "../src/lib/estimate-removal.core";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
test("approved no-insulation email stays byte identical", () => {
  expect(hash(renderStep3SaveSpot(S))).toBe("26df58bffb07b3eb6cc809dfb0f7789e6b15529d8602ddfd8ac4c69d163a18bb");
});
test("existing-insulation invitation locked after Jo 12 Oct 23:18 removal sentence", () => {
  const initial = renderLaunchCampaignEmail({group:"onsite",campaignUrl:"https://estimate.homeinsulationvictoria.com.au/estimate/"+"A".repeat(43)+"/campaign",unsubscribeUrl:S.unsubscribeUrl,firstName:S.firstName,estimatedTotal:S.estimatedTotal,veuDiscount:S.veuDiscount,grossTotal:S.grossTotal,areaM2:S.areaM2,insulation:"present",installation:S.installation,assessmentFee:S.assessmentFee,apFee:S.apFee});
  expect(hash(initial)).toBe("098c029d28810c91705e74b14542c4fbaac56442f11133ca6a43089fccd4e887");
});
test("primary zero-removal snapshot excludes removal; alternative price cannot override it", () => {
  expect(removalFromScenario({ removal: 0, removal_m2: 0 })).toEqual({kind:"excluded"});
  const mail = renderStep3SaveSpot({...S,existingInsulationPresent:true,removal:{kind:"excluded"}});
  expect(mail.html).toContain(REMOVAL_EXCLUDED);
  expect(mail.plainText).toContain(REMOVAL_EXCLUDED);
  expect(mail.plainText).toContain("preliminary queue only");
});
test("priced removal is a reconciled inclusion, never an exclusion", () => {
  const removal = removalFromScenario({ removal: 450, removal_m2: 150 });
  expect(removal).toEqual({kind:"included",amount:450,areaM2:150});
  const mail = renderStep3SaveSpot({...S,existingInsulationPresent:true,removal,grossTotal:S.grossTotal+450,estimatedTotal:S.estimatedTotal+450});
  expect(mail.html).toContain("includes $450 inc GST");
  expect(mail.plainText).toContain("Removal of existing insulation: $450 inc GST");
  expect(mail.html).not.toContain(REMOVAL_EXCLUDED);
  expect(mail.plainText).not.toContain(REMOVAL_EXCLUDED);
});
test("missing or inconsistent removal facts show the $15/m² budget note, never an amount", () => {
  for (const s of [null,{}, {removal:0}, {removal:0,removal_m2:150}, {removal:-1,removal_m2:150}]) {
    expect(removalFromScenario(s)).toEqual({kind:"unknown"});
    expect(removalNote(removalFromScenario(s))).toBe(REMOVAL_BUDGET_EMAIL_NOTE);
  }
});
const EXACT = "Existing insulation may need to be removed. Please budget $15 per m² including GST for the areas that need removal only. We’ll assess this at your free Ready Check and confirm the area and cost before you approve any removal.";
test("Jo's exact removal sentence (23:18 UTC)", () => { expect(REMOVAL_BUDGET_EMAIL_NOTE).toBe(EXACT); });
test("existing-insulation save-spot email shows the note in HTML and plain text for excluded and unknown", () => {
  for (const removal of [{kind:"excluded"} as const, {kind:"unknown"} as const]) {
    const m = renderStep3SaveSpot({...S,existingInsulationPresent:true,removal});
    expect(m.plainText).toContain(EXACT); expect(m.html).toContain("$15 per m² including GST for the areas that need removal only");
    expect(m.html).toContain("free Ready Check");
  }
});
test("onsite review email shows the note in HTML and plain text, no whole-ceiling removal added", () => {
  const m = renderLaunchCampaignEmail({group:"onsite",campaignUrl:"https://estimate.homeinsulationvictoria.com.au/estimate/"+"A".repeat(43)+"/campaign",unsubscribeUrl:S.unsubscribeUrl,firstName:S.firstName,estimatedTotal:S.estimatedTotal,veuDiscount:S.veuDiscount,grossTotal:S.grossTotal,areaM2:S.areaM2,insulation:"present",installation:S.installation,assessmentFee:S.assessmentFee,apFee:S.apFee});
  expect(m.plainText).toContain(EXACT); expect(m.html).toContain("$15 per m² including GST for the areas that need removal only");
  expect(m.plainText).not.toMatch(/Removal of existing insulation: \$/);
});
test("itemised removal stays authoritative: no $15 budget note", () => {
  const m = renderStep3SaveSpot({...S,existingInsulationPresent:true,removal:{kind:"included",amount:450,areaM2:30},grossTotal:S.grossTotal+450,estimatedTotal:S.estimatedTotal+450});
  expect(m.plainText).toContain("Removal of existing insulation: $450 inc GST"); expect(m.plainText).not.toContain("$15 per m²"); expect(m.html).not.toContain("$15 per m²");
});
test("no-existing-insulation email never mentions removal budget", () => {
  const m = renderStep3SaveSpot(S); expect(m.plainText).not.toContain("$15 per m²"); expect(m.html).not.toContain("$15 per m²");
});
