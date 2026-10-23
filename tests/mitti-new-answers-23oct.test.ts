// Jo 23 Oct 2026: new Mitti Ready Check answers on A1 + A2.
import { describe, expect, test } from "bun:test";
import { buildPrefill, parseAudit, validateStoredMittiAudit } from "../src/lib/mitti.core";
import { websiteStopReasons, readyCheckStopReasons, removalTotalM2, difficultAccessFee, STOP_BUILT_5, STOP_LIFE_SUPPORT, STOP_NO_CONTACT, STOP_R2 } from "../src/lib/ready-check-answers.core";
import { readyCheckCompletionChecks, readyCheckFactsFromEntries } from "../src/lib/ready-check-complete.core";
import { installDayPhotoNeeds, installDayPhotoBlocker } from "../src/lib/ready-check-chase.core";
import { validateQuotedPrice } from "../src/lib/mitti-forms.core";
import { applyMittiRemoval } from "../src/lib/mitti-installer-quote.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";

const sel = (...labels: string[]) => ({ selected: labels.map((label) => ({ label })) });
const e = (label: string, value: string | null) => ({ label, value });
const R = "What is the determined R value of the existing ceiling insulation?";
const REM = "How much existing insulation needs to be removed? (m²)";
const opts = { formComplete: true, electricianDecided: true, priceKnown: true };

describe("1–4 hard stops: no quote, exact office wording", () => {
  test("1 consent No", () => expect(readyCheckStopReasons([e("Homeowner agrees to be contacted by Home Insulation Victoria", "No")])).toEqual([STOP_NO_CONTACT]));
  test("2 Above R2.0 in ANY area", () => {
    expect(readyCheckStopReasons([e(R, "Below R2.0"), e(R, "Above R2.0")])).toEqual([STOP_R2]);
    expect(readyCheckStopReasons([e(R, "Below R2.0"), e(R, "Below R2.0")])).toEqual([]);
  });
  test("3 life support Yes", () => expect(readyCheckStopReasons([e("Life support equipment at property?", "Yes")])).toEqual([STOP_LIFE_SUPPORT]));
  test("4 built in last 5 years Yes", () => expect(readyCheckStopReasons([e("Was the ceiling or roof built or replaced in the last 5 years?", "Yes")])).toEqual([STOP_BUILT_5]));
  test("all No → no stops; office list uses exact wording", () => {
    const ok = [e("Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"), e("Life support equipment at property?", "No"), e("Was the ceiling or roof built or replaced in the last 5 years?", "No"), e(R, "Below R2.0")];
    expect(readyCheckStopReasons(ok)).toEqual([]);
    const bad = [e("Homeowner agrees to be contacted by Home Insulation Victoria", "No"), e("Life support equipment at property?", "Yes"), e("Was the ceiling or roof built or replaced in the last 5 years?", "Yes"), e(R, "Above R2.0")];
    const r = readyCheckCompletionChecks(readyCheckFactsFromEntries(bad, opts));
    expect(r.ready).toBe(false);
    for (const s of [STOP_NO_CONTACT, STOP_R2, STOP_LIFE_SUPPORT, STOP_BUILT_5]) expect(r.reasons).toContain(s);
  });
});

describe("5 removal total from every area", () => {
  test("sums all areas, ignores 0/blank", () => expect(removalTotalM2([e(REM, "40"), e(REM, "25.5"), e(REM, "0"), e(REM, null)])).toBe(65.5));
  test("shown on the installer line, never priced", () => {
    const d = { lines: [{ code: "INSTALLER_PRICE", description: "Supply and install of Bradford Gold R6 ceiling insulation – 120 m²" }] };
    applyMittiRemoval(d, 65.5);
    expect(d.lines[0]!.description).toBe("Supply and install of Bradford Gold R6 ceiling insulation – 120 m² · Removal of existing insulation – 65.5 m²");
  });
});

describe("6 difficult access fee", () => {
  const acc = (a: string, yes: string, fee: string | null) => [e("How would you rate the ceiling access?", a), e("Is an extra fee being charged for difficult access?", yes), e("Difficult access fee ($ inc GST)", fee)];
  test("Difficult + Yes → fee", () => expect(difficultAccessFee(acc("Difficult", "Yes", "$250")).amountIncGst).toBe(250));
  test("No fee when not Difficult or answered No", () => {
    expect(difficultAccessFee(acc("Easy", "Yes", "250")).amountIncGst).toBeNull();
    expect(difficultAccessFee(acc("Difficult", "No", "250")).amountIncGst).toBeNull();
  });
  test("Yes with no amount → office reason", () => expect(difficultAccessFee(acc("Difficult", "Yes", null)).reason).toMatch(/difficult access fee/));
  test("own quote line 'Difficult access fee'", () => {
    const price = validateQuotedPrice({ included: ["Ceiling insulation - supply & install", "Difficult access charge"], totalIncGst: 3000, removalRequired: false });
    expect(price.ok).toBe(true);
    const d = buildInstallerQuoteDraft({ price, measuredM2: 100, wholeVeec: { veecs: 10, raw: 500 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 }, separateLines: [{ code: "DIFFICULT_ACCESS", description: "Difficult access fee", amountIncGst: 250 }] });
    const line = d.lines.find((l) => l.code === "DIFFICULT_ACCESS");
    expect(line).toMatchObject({ description: "Difficult access fee", line_total_inc_gst: 250 });
    expect(d.subtotal).toBe(3000 + 250 + 349 + 349);
  });
});

describe("7 install-day photo lock", () => {
  test("missing photos become required install-day photos; on the form = not asked", () => {
    const needs = installDayPhotoNeeds({ access: false, areas: [{ area: 1, insulated: true, depth: false, overview: true }, { area: 2, insulated: false, depth: false, overview: false }] });
    expect(needs.map((n) => n.label)).toEqual(["Install day: ceiling access photo", "Install day: Area 1 existing insulation depth photo", "Install day: Area 2 overview photo"]);
    expect(installDayPhotoNeeds({ access: true, areas: [{ area: 1, insulated: true, depth: true, overview: true }] })).toEqual([]);
  });
  test("depth photo requirement locks completion", () => {
    expect(installDayPhotoBlocker([{ category: "existing_insulation_r_value", label: "Install day: Area 1 existing insulation depth photo", gate: "installation", required: true, status: "outstanding" }])).toMatch(/Area 1 existing insulation depth photo/);
  });
  test("photos no longer block the quote", () => {
    const r = readyCheckCompletionChecks({ formComplete: true, belowR2: true, lifeSupportReviewed: true, depthPhoto: false, overviewPhoto: false, contactPermission: true, electricianDecided: true, priceKnown: true });
    expect(r.ready).toBe(true);
  });
  test("parseAudit reports photo gaps per area (media items)", () => {
    const p = parseAudit({ audit_id: "a", items: [
      { item_id: "acc", label: "Upload a clear photo of the ceiling access point", media: [{ media_id: "x" }] },
      { item_id: "a1", label: "Area 1" },
      { item_id: "a1m", parent_id: "a1", label: "Enter the measured ceiling area (m²)", responses: { number: 80 } },
      { item_id: "a1i", parent_id: "a1", label: "Is there existing insulation in this ceiling area?", responses: sel("Yes") },
      { item_id: "a1o", parent_id: "a1", label: "Upload an overview photo of this ceiling area", media: [] },
    ] });
    expect(p.photoGaps).toEqual({ access: true, areas: [{ area: 1, insulated: true, depth: false, overview: false }] });
  });
});

describe("8 A2 prefill tap choices; A1 without Portal Job Number", () => {
  const rs = (id: string, labels: string[]) => ({ id, responses: labels.map((l, i) => ({ id: `${id}-${i}`, label: l })) });
  const tpl = { template: { items: [
    { id: "pj", label: "Portal Job Number", textsingle: {} },
    { id: "pt", label: "Property type", question: { response_set_id: "rsP" } },
    { id: "ls", label: "Life support equipment at property?", question: { response_set_id: "rsY" } },
    { id: "b5", label: "Was the ceiling or roof built or replaced in the last 5 years?", question: { response_set_id: "rsY" } },
    { id: "ad", label: "Site address", textsingle: {} }, { id: "on", label: "Homeowner name", textsingle: {} },
  ], response_sets: [rs("rsP", ["House", "Townhouse", "Unit or apartment", "Other"]), rs("rsY", ["Yes", "No"])] } };
  const base = { jobNumber: "HV-1", address: "1 Test St", ownerName: "TEST", assessorName: "x" };
  test("fills choices from the owner's answers", () => {
    const p = buildPrefill(tpl, { ...base, propertyType: "Townhouse", lifeSupport: "None recorded by office", builtLast5Years: "No" });
    const pick = (id: string) => p.items.find((i: { item_id: string }) => i.item_id === id)?.responses.selected[0].label;
    expect([pick("pt"), pick("ls"), pick("b5"), p.missing.length]).toEqual(["Townhouse", "No", "No", 0]);
  });
  test("unknown answers stay blank", () => {
    const p = buildPrefill(tpl, { ...base, propertyType: null, lifeSupport: null, builtLast5Years: null });
    expect(p.items.map((i: { item_id: string }) => i.item_id).sort()).toEqual(["ad", "on", "pj"]);
  });
  test("A1 template without Portal Job Number prefills without error", () => {
    const a1 = { template: { ...tpl.template, items: tpl.template.items.filter((i) => i.id !== "pj") } };
    expect(buildPrefill(a1, base).missing).toEqual([]);
  });
  test("A1 audit without Portal Job Number validates by stored form ID; A2 mismatch still blocks", () => {
    expect(() => validateStoredMittiAudit({ audit_id: "a1", template_id: "template_01ee0428be6d4435b34d8b738935f099", items: [] }, { storedAuditId: "a1", jobNumber: "HV-1", templateId: "template_01ee0428be6d4435b34d8b738935f099" })).not.toThrow();
    expect(() => validateStoredMittiAudit({ audit_id: "a2", template_id: "template_01ee0428be6d4435b34d8b738935f099", header_items: [{ item_id: "h", label: "Portal Job Number", responses: { text: "HV-9" } }], items: [] }, { storedAuditId: "a2", jobNumber: "HV-1", templateId: "template_01ee0428be6d4435b34d8b738935f099" })).toThrow();
  });
});

describe("9 number question types", () => {
  test("area, removal, downlights and price read from number answers", () => {
    const p = parseAudit({ audit_id: "a", items: [
      { item_id: "a1", label: "Area 1" },
      { item_id: "m", parent_id: "a1", label: "Enter the measured ceiling area (m²)", responses: { number: 95.5 } },
      { item_id: "act", parent_id: "a1", label: "What is required for the existing insulation?", responses: sel("Remove") },
      { item_id: "rm", parent_id: "a1", label: REM, responses: { number: 30 } },
      { item_id: "dl", parent_id: "a1", label: "How many?", responses: { number: 6 } },
      { item_id: "tp", label: "Total quoted price (inc GST)", responses: { number: 4200 } },
    ] });
    expect(p.patch).toMatchObject({ measured_area_m2: 95.5, removal_m2: 30, downlights_qty: 6 });
    expect(p.snapshot.find((s) => s.label === "Total quoted price (inc GST)")?.value).toBe("4200");
  });
});

describe("10 fail reasons multi pick list", () => {
  test("every selected option is read", () => {
    const p = parseAudit({ audit_id: "a", items: [
      { item_id: "o", label: "Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?", responses: sel("No - Ready Check failed") },
      { item_id: "w", label: "Why did the property fail the ready check? Select all that apply", responses: sel("No safe access", "Existing insulation R2.0 or above") },
    ] });
    expect(p.failReasons).toEqual(["No safe access", "Existing insulation R2.0 or above"]);
    expect(p.patch.notes).toMatch(/No safe access, Existing insulation R2.0 or above/);
  });
});

describe("A2 uses the owner's website answers for life support / 5 years", () => {
  test("website Yes → same office items; A2 form answers ignored", () => {
    expect(websiteStopReasons({ lifeSupportStatus: "yes", overFiveYears: "no" })).toEqual([STOP_LIFE_SUPPORT, STOP_BUILT_5]);
    expect(websiteStopReasons({ lifeSupportStatus: "no", overFiveYears: "yes" })).toEqual([]);
    expect(readyCheckStopReasons([e("Life support equipment at property?", "Yes"), e("Was the ceiling or roof built or replaced in the last 5 years?", "Yes")], { ownerAnsweredOnWebsite: true })).toEqual([]);
  });
});
