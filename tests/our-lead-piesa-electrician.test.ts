// Decision 157 (Jo, 24 Oct 2026): our-lead PIESA → the installer's usual electrician at the onboarding rate.
// Decision 349 (Jo, 25 Oct 2026): the owner's PIESA line passes that rate through; our electrician → $349.
import { describe, expect, test } from "bun:test";
import { electricianSourceFor, matchUsualElectrician, normaliseLicence, ourLeadPiesaElectrician, ownerPiesaLineIncGst, piesaPayableRate, NO_USUAL_ELECTRICIAN_NOTE, USUAL_ELECTRICIAN_RATE_ID_PREFIX } from "../src/lib/our-lead-piesa-electrician.core";
import { resolveMittiElectrician, usualElectrician } from "../src/lib/usual-electrician.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";
import { safetyCheckCentsFor } from "../src/lib/safety-check-amount.core";

// Jo's fixture: RAPID Insulation's usual electrician is paid $275 inc GST for the PIESA (rate agreed at onboarding).
const rapidUsual = usualElectrician({ name: "Sparkie Co Pty Ltd", licence: "REC 12345", priceIncGst: 275 })!;
const recs = [
  { business_id: "rec-a", name: "Other Electrical", rec_number: "REC-99999", worker_licences: ["A-1"], blocker: null },
  { business_id: "rec-sparkie", name: "Sparkie Co", trading_name: "Sparkie Co Pty Ltd", rec_number: "rec-12345", worker_licences: ["E-55"], blocker: null },
];

describe("our-lead PIESA electrician (decision 157)", () => {
  test("licence numbers match loosely (case, spaces, dashes)", () => {
    expect(normaliseLicence(" rec-12 345 ")).toBe("REC12345");
    expect(matchUsualElectrician(rapidUsual, recs)?.business_id).toBe("rec-sparkie");
    expect(matchUsualElectrician({ ...rapidUsual, licence: "e55" }, recs)?.business_id).toBe("rec-sparkie");
  });
  test("falls back to the business name when no licence matches", () => {
    expect(matchUsualElectrician({ ...rapidUsual, licence: "ZZZ" }, recs)?.business_id).toBe("rec-sparkie");
    expect(matchUsualElectrician({ name: "Nobody", licence: "ZZZ", priceIncGst: 1 }, recs)).toBeNull();
  });
  test("RAPID our-lead job with a usual electrician set → PIESA to that REC at $275 inc GST", () => {
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: rapidUsual, revision: "cfg-1", candidates: recs });
    expect(sel.mode).toBe("usual");
    if (sel.mode !== "usual") throw new Error("expected usual");
    expect(sel.businessId).toBe("rec-sparkie");
    expect(sel.rateIncGst).toBe(275);
    expect(sel.rateId).toBe(`${USUAL_ELECTRICIAN_RATE_ID_PREFIX}cfg-1`);
    // What we pay: $275 to the usual electrician, the office-agreed rate to anyone else, never the owner price.
    expect(piesaPayableRate(sel, "rec-sparkie", { id: "rate-x", rate: 300 })).toEqual({ id: sel.rateId, rate: 275, source: "installer_usual_electrician" });
    expect(piesaPayableRate(sel, "rec-a", { id: "rate-a", rate: 300 })).toEqual({ id: "rate-a", rate: 300, source: "agreed_rate" });
    expect(piesaPayableRate(sel, "rec-a", null)).toBeNull();
  });
  test("no usual electrician saved → office sends to any approved REC (existing pick path), no automatic choice", () => {
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: null, candidates: recs });
    expect(sel.mode).toBe("office_pick");
    expect(sel.businessId).toBeNull();
    expect(sel.note).toBe(NO_USUAL_ELECTRICIAN_NOTE);
  });
  test("usual electrician not onboarded or blocked → office pick with a reason, never a made-up business", () => {
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: { name: "Unknown Sparks", licence: "X-1", priceIncGst: 250 }, candidates: recs });
    expect(sel.mode).toBe("usual_not_onboarded");
    expect(sel.note).toContain("not an approved electrician on the portal");
    const blocked = ourLeadPiesaElectrician({ channel: "website", usual: rapidUsual, candidates: recs.map((c) => c.business_id === "rec-sparkie" ? { ...c, blocker: "Licence expired." } : c) });
    expect(blocked.mode).toBe("usual_not_onboarded");
    expect(blocked.note).toContain("Licence expired.");
  });
  test("never applies to installer-sourced (A1) jobs — they keep the Mitti electrician choice", () => {
    expect(ourLeadPiesaElectrician({ channel: "installer_sourced", usual: rapidUsual, candidates: recs }).mode).toBe("not_our_lead");
    expect(resolveMittiElectrician({ choice: "usual", usual: rapidUsual, different: { name: null, licence: null, priceIncGst: null } }).priceIncGst).toBe(275);
  });
  test("decision 349: installer's usual electrician → owner's PIESA line = their onboarding rate exactly (no margin)", () => {
    const usual220 = usualElectrician({ name: "Sparkie Co Pty Ltd", licence: "REC 12345", priceIncGst: 220 })!;
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: usual220, revision: "cfg-1", candidates: recs });
    expect(sel.mode).toBe("usual");
    expect(ownerPiesaLineIncGst(349, sel)).toBe(220);
    // what we pay them = what the owner pays for the PIESA
    expect(piesaPayableRate(sel, "rec-sparkie", { id: "rate-x", rate: 260 })!.rate).toBe(220);
    const q = priceHivQuote({ areaM2: 100, removalM2: 0, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: ownerPiesaLineIncGst(349, sel), apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 15, installerRemovalExPerM2: null, installerTravelEx: null });
    expect(q.lines.find((l) => l.code === "PIESA")?.line_total_inc_gst).toBe(220);
    // decision 302/342: the safety-check payment (and the repeat-PIESA charge) read this line → $220
    expect(safetyCheckCentsFor({ lines: q.lines, settingIncGst: 349 })).toEqual({ cents: 22_000, source: "quote_line" });
  });
  test("decision 349: our electrician (no usual / not onboarded / blocked) → owner pays $349; we pay that REC's own agreed rate", () => {
    const none = ourLeadPiesaElectrician({ channel: "website", usual: null, candidates: recs });
    expect(ownerPiesaLineIncGst(349, none)).toBe(349);
    // a non-$275 agreed onboarding rate is what we pay (never a hard-coded figure)
    expect(piesaPayableRate(none, "rec-a", { id: "rate-a", rate: 262.5 })).toEqual({ id: "rate-a", rate: 262.5, source: "agreed_rate" });
    const notOnboarded = ourLeadPiesaElectrician({ channel: "website", usual: { name: "Unknown Sparks", licence: "X-1", priceIncGst: 220 }, candidates: recs });
    expect(ownerPiesaLineIncGst(349, notOnboarded)).toBe(349);
    const blocked = ourLeadPiesaElectrician({ channel: "website", usual: rapidUsual, candidates: recs.map((c) => c.business_id === "rec-sparkie" ? { ...c, blocker: "Licence expired." } : c) });
    expect(ownerPiesaLineIncGst(349, blocked)).toBe(349);
    expect(ownerPiesaLineIncGst(349, ourLeadPiesaElectrician({ channel: "installer_sourced", usual: rapidUsual, candidates: recs }))).toBe(349);
  });
  test("decision 349: electricianSourceFor — the assigned electrician business IS the installer's usual one", () => {
    expect(electricianSourceFor({ usual: rapidUsual, assigned: recs[1]! })).toBe("installer_usual");
    expect(electricianSourceFor({ usual: rapidUsual, assigned: recs[0]! })).toBe("ours");
    expect(electricianSourceFor({ usual: null, assigned: recs[1]! })).toBe("ours");
    expect(electricianSourceFor({ usual: rapidUsual, assigned: null })).toBe("ours");
  });
});
