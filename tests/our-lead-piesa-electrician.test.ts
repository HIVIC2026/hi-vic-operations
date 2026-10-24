// Decision 157 (Jo, 24 Oct 2026): our-lead PIESA → the installer's usual electrician at the onboarding rate; owner price unchanged.
import { describe, expect, test } from "bun:test";
import { matchUsualElectrician, normaliseLicence, ourLeadPiesaElectrician, ownerPiesaLineIncGst, piesaPayableRate, NO_USUAL_ELECTRICIAN_NOTE, USUAL_ELECTRICIAN_RATE_ID_PREFIX } from "../src/lib/our-lead-piesa-electrician.core";
import { resolveMittiElectrician, usualElectrician } from "../src/lib/usual-electrician.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";

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
  test("owner's safety-check line stays HIV's standard price whoever does the PIESA", () => {
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: rapidUsual, revision: "cfg-1", candidates: recs });
    expect(ownerPiesaLineIncGst(349, sel)).toBe(349);
    const q = priceHivQuote({ areaM2: 100, removalM2: 0, accessMultiplier: 1, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: 349, apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 15, installerRemovalExPerM2: null, installerTravelEx: null });
    const piesa = q.lines.find((l) => l.code === "PIESA");
    expect(piesa?.line_total_inc_gst).toBe(349);
  });
});
