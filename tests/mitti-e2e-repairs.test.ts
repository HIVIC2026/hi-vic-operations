import { describe, expect, test } from "bun:test";
import { mittiQuoteReleaseBlockers, pickupJobSource, quoteListIncludes, installerEnteredText } from "../src/lib/mitti-quote-release.core";
import { installerQuoteReleaseBlockers } from "../src/lib/installer-intake.core";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiElectrician } from "../src/lib/usual-electrician.core";
import { buildMittiInstallerQuote } from "../src/lib/mitti-installer-quote.core";

describe("Jo's approved Mitti E2E repairs", () => {
  const different = { name: "TEST Sparky", licence: "TEST-REC-1", priceIncGst: "400" };
  test("Mitti A1/A2 fee disclosure is on the quote, never a separate awareness hold", () => {
    const electrical = resolveMittiElectrician({ choice: "different", usual: null, different });
    expect(mittiQuoteReleaseBlockers("granted", electrical)).toEqual([]);
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: false })).toContain("Owner fee awareness not recorded yet");
  });
  test("all three electrical choices clear only with required identity and price", () => {
    for (const [answer, choice] of [["Home Insulation Victoria electrician", "hivic"], ["My usual electrician", "usual"], ["A different electrician", "different"]] as const) {
      const parsed = contactAnswersFromEntries([{ label: "Who is doing the electrical safety check?", value: answer }]);
      expect(parsed.electricianChoice).toBe(choice);
      const e = resolveMittiElectrician({ choice, usual: { name: "TEST usual", licence: "TEST-REC-2", priceIncGst: 275 }, different });
      expect(mittiQuoteReleaseBlockers("granted", e)).toEqual([]);
    }
    expect(mittiQuoteReleaseBlockers("granted", null)).toEqual(["Electrician arrangement is not decided"]);
    expect(mittiQuoteReleaseBlockers("granted", resolveMittiElectrician({ choice: "different", usual: null, different: { ...different, licence: null } }))).toEqual(["Different electrician name, licence number and price are required"]);
  });
  test("owner consent remains mandatory", () => {
    expect(mittiQuoteReleaseBlockers(null, resolveMittiElectrician({ choice: "hivic", usual: null, different }))).toEqual(["No current owner contact consent on record"]);
  });
  test("TEST partner source comes from persisted business mark; ordinary and missing businesses stay live", () => {
    expect(pickupJobSource({ onboarding_notes: "[TEST PARTNER] Reinsulate" })).toBe("qa_test");
    expect(pickupJobSource({ onboarding_notes: null })).toBe("installer_mitti");
    expect(pickupJobSource(null)).toBe("installer_mitti");
  });
  test("Office practice mode isolates practice jobs; default excludes them", () => {
    expect(quoteListIncludes("qa_test", false)).toBe(false);
    expect(quoteListIncludes("qa_test", true)).toBe(true);
    expect(quoteListIncludes("installer_mitti", true)).toBe(false);
    expect(quoteListIncludes(null, false)).toBe(true);
  });
  test("entered acronyms and names preserve spelling", () => {
    expect(installerEnteredText(" TEST E2E Owner ")).toBe("TEST E2E Owner");
    expect(installerEnteredText("9 E2E TEST Street")).toBe("9 E2E TEST Street");
  });
  test("full quote keeps $4200 installer + $349 fee + $400 electrician minus $1120 rebate", () => {
    const d = buildMittiInstallerQuote({ price: { ok: true, issues: [], price: { totalIncGst: 4200, included: ["R5 supply and install"], otherDescription: "", agreedWithOwner: false } }, measuredM2: 120, wholeVeec: { veecs: 16, raw: 1120 }, caps: { metropolitan: true, minCopay: 200 } }, resolveMittiElectrician({ choice: "different", usual: null, different }));
    expect(d.subtotal).toBe(4949); expect(d.afterDiscount).toBe(3829); expect(d.lines.map(l => l.line_total_inc_gst)).toEqual([4200,400,349]);
  });
});