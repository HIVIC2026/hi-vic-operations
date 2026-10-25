// Decision 374 (Jo 25 Oct 2026: "we ALWAYS choose the electrician – not the installer choosing") replaces decisions
// 157/349/353 on our leads (A2): no usual-electrician preference, the electrician is always ours, the owner pays $349
// (decision 373) and +$100 on fixes; we pay the electrician their own onboarding rate. A1 is unchanged (decision 351).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as core from "../src/lib/our-lead-piesa-electrician.core";
import { electricianSourceFor, electricianSourceForA1, electricianSourceForOurLead, matchUsualElectrician, normaliseLicence, ownerPiesaLineIncGst } from "../src/lib/our-lead-piesa-electrician.core";
import { resolveMittiElectrician, usualElectrician } from "../src/lib/usual-electrician.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";
import { safetyCheckCentsFor } from "../src/lib/safety-check-amount.core";
import { fixesMarginFor } from "../src/lib/fixes-price.core";

const rapidUsual = usualElectrician({ name: "Sparkie Co Pty Ltd", licence: "REC 12345", priceIncGst: 275 })!;
const recs = [
  { business_id: "rec-a", name: "Other Electrical", rec_number: "REC-99999", worker_licences: ["A-1"], blocker: null },
  { business_id: "rec-sparkie", name: "Sparkie Co", trading_name: "Sparkie Co Pty Ltd", rec_number: "rec-12345", worker_licences: ["E-55"], blocker: null },
];
const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");

describe("our-lead PIESA electrician (decision 374: we always choose)", () => {
  test("licence numbers match loosely (case, spaces, dashes) — still used for A1 and REC onboarding", () => {
    expect(normaliseLicence(" rec-12 345 ")).toBe("REC12345");
    expect(matchUsualElectrician(rapidUsual, recs)?.business_id).toBe("rec-sparkie");
    expect(matchUsualElectrician({ ...rapidUsual, licence: "e55" }, recs)?.business_id).toBe("rec-sparkie");
    expect(matchUsualElectrician({ ...rapidUsual, licence: "ZZZ" }, recs)?.business_id).toBe("rec-sparkie");
    expect(matchUsualElectrician({ name: "Nobody", licence: "ZZZ", priceIncGst: 1 }, recs)).toBeNull();
  });
  test("the decision-157 usual-electrician selection for our leads is gone", () => {
    for (const k of ["ourLeadPiesaElectrician", "piesaPayableRate", "USUAL_ELECTRICIAN_RATE_ID_PREFIX", "NO_USUAL_ELECTRICIAN_NOTE"]) expect(k in core, k).toBe(false);
    expect(src("our-lead-piesa-electrician.server.ts")).not.toContain("ourLeadPiesaSelection");
    for (const f of ["allocation.server.ts", "auto-offer.server.ts", "offer-dispatch.functions.ts", "quotes.server.ts"]) {
      expect(src(f), f).not.toContain("ourLeadPiesaSelection");
      expect(src(f), f).not.toContain("noteUsualElectricianApplied");
    }
  });
  test("A2: the electrician is always ours — even when it is the installer's usual electrician", () => {
    expect(electricianSourceForOurLead()).toBe("ours");
    const s = src("our-lead-piesa-electrician.server.ts");
    expect(s).toContain('if (job.channel !== "installer_sourced") return electricianSourceForOurLead();');
    // ours → the decision-142 $100 fixes margin
    expect(fixesMarginFor(electricianSourceForOurLead())).toBe(100);
  });
  test("A2 quote: the owner's PIESA line is $349 and the snapshot records our electrician", () => {
    expect(ownerPiesaLineIncGst(349)).toBe(349);
    const q = priceHivQuote({ areaM2: 100, removalM2: 0, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: ownerPiesaLineIncGst(349), apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 15, installerRemovalExPerM2: null, installerTravelEx: null });
    expect(q.lines.find((l) => l.code === "PIESA")?.line_total_inc_gst).toBe(349);
    expect(safetyCheckCentsFor({ lines: q.lines, settingIncGst: 349 })).toEqual({ cents: 34_900, source: "quote_line" });
    expect(src("quotes.server.ts")).toContain('const piesaElectrician = { source: "ours" as const, business_id: null, rate_inc_gst: null, rate_id: null };');
  });
  test("A1 is unchanged: the installer's usual electrician choice still resolves for their own customers", () => {
    expect(resolveMittiElectrician({ choice: "usual", usual: rapidUsual, different: { name: null, licence: null, priceIncGst: null } }).priceIncGst).toBe(275);
  });
  test("electricianSourceFor — the assigned electrician business IS the installer's usual one (A1 helper)", () => {
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
    expect(electricianSourceForA1({ choice: "usual", usual: rapidUsual, nominatedBusinessIds: ["rec-sparkie"], assigned: other })).toBe("ours");
    expect(electricianSourceForA1({ choice: "different", usual: null, nominatedBusinessIds: ["rec-a"], assigned: other })).toBe("installer_usual");
    expect(electricianSourceForA1({ choice: "different", usual: null, nominatedBusinessIds: ["rec-a"], assigned: sparkie })).toBe("ours");
    expect(electricianSourceForA1({ choice: "usual", usual: rapidUsual, nominatedBusinessIds: [], assigned: null })).toBe("ours");
  });
  test("Choose electrician: no 'usual electrician' mark or preference", () => {
    expect(src("offer-dispatch.functions.ts")).not.toContain("usualElectrician");
    expect(readFileSync("src/components/portal/choose-electrician.tsx", "utf8")).not.toContain("usualElectrician");
  });
});
