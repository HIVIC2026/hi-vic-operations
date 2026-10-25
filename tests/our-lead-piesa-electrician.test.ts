// Decision 157 (Jo, 24 Oct 2026): our-lead PIESA → the installer's usual electrician at the onboarding rate.
// Decision 349 (Jo, 25 Oct 2026): the owner's PIESA line passes that rate through; our electrician → $349.
import { describe, expect, test } from "bun:test";
import { electricianSourceFor, electricianSourceForA1, matchUsualElectrician, normaliseLicence, ourLeadPiesaElectrician, ownerPiesaLineIncGst, piesaPayableRate, NO_USUAL_ELECTRICIAN_NOTE, USUAL_ELECTRICIAN_RATE_ID_PREFIX } from "../src/lib/our-lead-piesa-electrician.core";
import { resolveMittiElectrician, usualElectrician } from "../src/lib/usual-electrician.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";
import { safetyCheckCentsFor } from "../src/lib/safety-check-amount.core";

// Jo's fixture: RAPID Insulation's usual electrician is paid $275 inc GST for the PIESA — decision 353: that is the
// electrician's OWN onboarding rate (electrician_rates PIESA row "rate-sparkie"); the My business price is not used.
const rapidUsual = usualElectrician({ name: "Sparkie Co Pty Ltd", licence: "REC 12345", priceIncGst: 275 })!;
const recs = [
  { business_id: "rec-a", name: "Other Electrical", rec_number: "REC-99999", worker_licences: ["A-1"], blocker: null, piesa_rate: { id: "rate-a", rate_inc_gst: 300 } },
  { business_id: "rec-sparkie", name: "Sparkie Co", trading_name: "Sparkie Co Pty Ltd", rec_number: "rec-12345", worker_licences: ["E-55"], blocker: null, piesa_rate: { id: "rate-sparkie", rate_inc_gst: "275.00" } },
];
const withSparkieRate = (rate: number | null) => recs.map((c) => c.business_id === "rec-sparkie" ? { ...c, piesa_rate: rate == null ? null : { id: "rate-sparkie-2", rate_inc_gst: rate } } : c);

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
    expect(sel.rateId).toBe("rate-sparkie"); // decision 353: the electrician_rates row, not the My business revision
    expect(sel.rateId.startsWith(USUAL_ELECTRICIAN_RATE_ID_PREFIX)).toBe(false);
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
  test("decision 373: installer's usual electrician → owner still pays $349; we pay THEIR onboarding rate", () => {
    // The installer typed $220 on My business; the electrician's own onboarding rate is $220 here.
    const usual220 = usualElectrician({ name: "Sparkie Co Pty Ltd", licence: "REC 12345", priceIncGst: 220 })!;
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: usual220, revision: "cfg-1", candidates: withSparkieRate(220) });
    expect(sel.mode).toBe("usual");
    expect(ownerPiesaLineIncGst(349, sel)).toBe(349);
    // what we pay them = their own onboarding rate
    expect(piesaPayableRate(sel, "rec-sparkie", { id: "rate-x", rate: 260 })!.rate).toBe(220);
    const q = priceHivQuote({ areaM2: 100, removalM2: 0, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: ownerPiesaLineIncGst(349, sel), apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 15, installerRemovalExPerM2: null, installerTravelEx: null });
    expect(q.lines.find((l) => l.code === "PIESA")?.line_total_inc_gst).toBe(349);
    // decision 302/342: the safety-check payment (and the repeat-PIESA charge) read this line → $349
    expect(safetyCheckCentsFor({ lines: q.lines, settingIncGst: 349 })).toEqual({ cents: 34_900, source: "quote_line" });
  });
  test("decision 353: the My business price is NOT the rate — the electrician's own onboarding rate wins", () => {
    const typed = usualElectrician({ name: "Sparkie Co Pty Ltd", licence: "REC 12345", priceIncGst: 150 })!;
    const sel = ourLeadPiesaElectrician({ channel: "website", usual: typed, revision: "cfg-1", candidates: withSparkieRate(262.5) });
    if (sel.mode !== "usual") throw new Error("expected usual");
    expect(sel.rateIncGst).toBe(262.5);
    expect(sel.rateId).toBe("rate-sparkie-2");
    expect(sel.note).toContain("$262.50");
    expect(ownerPiesaLineIncGst(349, sel)).toBe(349);
    expect(piesaPayableRate(sel, "rec-sparkie", null)).toEqual({ id: "rate-sparkie-2", rate: 262.5, source: "installer_usual_electrician" });
  });
  test("decision 353: usual electrician with NO approved onboarding rate → not usable as usual: our electrician at $349", () => {
    for (const cands of [withSparkieRate(null), withSparkieRate(0)]) {
      const sel = ourLeadPiesaElectrician({ channel: "website", usual: rapidUsual, revision: "cfg-1", candidates: cands });
      expect(sel.mode).toBe("usual_not_onboarded");
      expect(sel.note).toContain("no approved onboarding PIESA rate");
      expect(ownerPiesaLineIncGst(349, sel)).toBe(349);
    }
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
  test("decision 351: A1 — HIV's electrician → ours; the installer's usual / nominated electrician when assigned → installer_usual", () => {
    const sparkie = recs[1]!, other = recs[0]!;
    expect(electricianSourceForA1({ choice: "hivic", usual: rapidUsual, nominatedBusinessIds: ["rec-sparkie"], assigned: sparkie })).toBe("ours");
    expect(electricianSourceForA1({ choice: "usual", usual: rapidUsual, nominatedBusinessIds: [], assigned: sparkie })).toBe("installer_usual");
    expect(electricianSourceForA1({ choice: "usual", usual: rapidUsual, nominatedBusinessIds: ["rec-sparkie"], assigned: sparkie })).toBe("installer_usual");
    // the installer's electrician couldn't do it and ours did → ours
    expect(electricianSourceForA1({ choice: "usual", usual: rapidUsual, nominatedBusinessIds: ["rec-sparkie"], assigned: other })).toBe("ours");
    // legacy "a different electrician" the installer nominated (resolved to an approved REC) → installer_usual only for that REC
    expect(electricianSourceForA1({ choice: "different", usual: null, nominatedBusinessIds: ["rec-a"], assigned: other })).toBe("installer_usual");
    expect(electricianSourceForA1({ choice: "different", usual: null, nominatedBusinessIds: ["rec-a"], assigned: sparkie })).toBe("ours");
    expect(electricianSourceForA1({ choice: "usual", usual: rapidUsual, nominatedBusinessIds: [], assigned: null })).toBe("ours");
  });
});
