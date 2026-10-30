// Jo 26 Oct 2026 (Deep's email): Reinsulate manages and pays its own electricians. Pure — no database.
// Run: bun test tests/installer-paid-electricians.test.ts
import { describe, expect, test } from "bun:test";
import { installerPaysOwnElectricians, safetyCheckPayee } from "../src/lib/installer-paid-electricians.core";
import { approvedRecBlocker, approvedRecFor, onboardedElectricianResolution, type ApprovedRecCandidate } from "../src/lib/rec-onboarded.core";
import { resolveMittiElectrician } from "../src/lib/usual-electrician.core";
import { stepErrors, visibleSteps, type RecData } from "../src/lib/rec-onboarding.core";

const REINSULATE = "a8304d2d-339b-4cbf-bcf1-fb09ce7935b0";
const business = { id: REINSULATE, name: "Reinsulate", in_house: true, piesaIncGst: 350 };
const rec = (over: Partial<ApprovedRecCandidate> = {}): ApprovedRecCandidate => ({
  business_id: "rec-1", name: "Orlando Powered Pty Ltd", trading_name: "Orlando Powered", rec_number: "30614", worker_licences: ["A63151"],
  onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: null, ...over,
});

describe("which installers pay their own electricians", () => {
  test("Reinsulate (and its TEST partner) at a flat $350; everyone else is paid by us as before", () => {
    expect(installerPaysOwnElectricians(business)).toMatchObject({ name: "Reinsulate", piesaIncGst: 350 });
    expect(installerPaysOwnElectricians({ ...business, id: "17793408-bf5c-4ddd-9bec-64199f64f9fb" })?.piesaIncGst).toBe(350);
    expect(installerPaysOwnElectricians({ ...business, in_house: false })).toBeNull();
    expect(installerPaysOwnElectricians({ ...business, id: "new-partner", piesaIncGst: 420 })?.piesaIncGst).toBe(420);
    expect(installerPaysOwnElectricians({ ...business, piesaIncGst: null })).toBeNull();
    expect(installerPaysOwnElectricians(null)).toBeNull();
  });
  test("our own electrician on a Reinsulate job is still paid directly", () => {
    expect(safetyCheckPayee({ business, electricianChoice: "hivic" })).toBeNull();
    expect(safetyCheckPayee({ business, electricianChoice: null })).toBeNull();
    expect(safetyCheckPayee({ business, electricianChoice: "usual" })?.businessId).toBe(REINSULATE);
    expect(safetyCheckPayee({ business: { ...business, in_house: false }, electricianChoice: "usual" })).toBeNull();
  });
});

describe("owner quote: flat $350 for Reinsulate's own electrician, no REC rate needed", () => {
  test("an approved REC with no PIESA rate is fine when the installer pays; still held otherwise", () => {
    expect(approvedRecBlocker(rec())).toBe("no active onboarded PIESA rate");
    expect(approvedRecBlocker(rec(), { rateNotNeeded: true })).toBeNull();
    expect(approvedRecFor({ name: "Orlando Powered", licence: "A63151" }, [rec()], 350).rec).toMatchObject({ businessId: "rec-1", piesaRateIncGst: 350, rateId: null });
    // Licence, REC and approval are still checked.
    expect(approvedRecBlocker(rec({ onboarding_status: "submitted" }), { rateNotNeeded: true })).toBe("not an approved, active REC on the portal");
    expect(approvedRecFor({ name: "Orlando Powered", licence: "A63151" }, [rec({ approved_electricians: 0 })], 350).rec).toBeNull();
  });
  test("the installer's declared price never reaches the owner — $350 does", () => {
    const usual = { name: "Orlando Powered", licence: "A63151", priceIncGst: 200, email: null };
    const legacy = resolveMittiElectrician({ choice: "usual", usual, different: { name: null, licence: null, priceIncGst: null } });
    expect(onboardedElectricianResolution({ legacy, usual, candidates: [rec()], flatPiesaIncGst: 350 })).toMatchObject({ ready: true, priceIncGst: 350, recBusinessId: "rec-1" });
    expect(onboardedElectricianResolution({ legacy, usual, candidates: [rec()] }).ready).toBe(false); // no rate, not Reinsulate
  });
});

describe("electrician sign-up when invited by Reinsulate", () => {
  const base: RecData = { works_under_rec: false, gst_registered: true };
  test("no safety check or attendance rate asked; GST still asked; bank page still shown (fixes are paid to them)", () => {
    expect(stepErrors("assessment_pricing", { ...base, paid_by_installer: true })).toEqual([]);
    expect(stepErrors("assessment_pricing", { ...base, paid_by_installer: true, gst_registered: null })).toContain("Tell us if you're GST registered.");
    expect(stepErrors("assessment_pricing", base)).toContain("Enter your PIESA visit rate.");
    expect(visibleSteps({ ...base, paid_by_installer: true }).some((s) => s.key === "bank")).toBe(true);
  });
});
