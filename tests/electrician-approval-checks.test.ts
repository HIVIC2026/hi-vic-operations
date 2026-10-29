import { describe, expect, test } from "bun:test";
import { activationBlockers, electricianLicenceBlockers, mandatoryActivationBlockers } from "../src/lib/partner-activation.core";
import { readFileSync } from "node:fs";
import { REC_AGREEMENT_VERSION, type RecData } from "../src/lib/rec-onboarding.core";

// Jo 27 Oct 2026 (decision 415): approving an electrician stops on a missing/expired licence, no REC number, cover
// under $5m, or a PIESA price over $349 inc GST — the office can still approve with a written reason (same as insurance).
const NOW = new Date("2026-10-27T03:00:00Z");
const good = (): RecData => ({ public_liability_expiry: "2027-06-30", public_liability_cover_amount: 20_000_000, licence_number: "A12345", licence_expiry: "2028-01-01", rec_registration_number: "30840", assessment_rate: 220, gst_registered: true } as RecData);
const stop = (d: Partial<RecData>) => activationBlockers("rec", { ...good(), ...d } as RecData, REC_AGREEMENT_VERSION, "2026-10-27", NOW);

describe("Electrician approval checks (decision 415)", () => {
  test("a complete electrician passes", () => { expect(stop({})).toEqual([]); });
  // Guide fix 3 (Jo 29 Oct 2026): a missing or expired licence is a HARD block — no "approve anyway" override.
  const hard = (d: Partial<RecData>) => mandatoryActivationBlockers("rec", { ...good(), ...d } as RecData, undefined, NOW);
  test("licence missing or expired is a hard block, not an override", () => {
    expect(hard({ licence_number: "" })).toEqual(["Electrical licence is missing."]);
    expect(hard({ licence_expiry: "2026-10-01" })).toEqual(["Electrical licence is expired or has no expiry date."]);
    expect(hard({ licence_expiry: undefined })).toEqual(["Electrical licence is expired or has no expiry date."]);
    expect(hard({})).toEqual([]);
    expect(electricianLicenceBlockers({ ...good(), licence_number: " " } as RecData, NOW)).toEqual(["Electrical licence is missing."]);
    for (const d of [{ licence_number: "" }, { licence_expiry: "2026-10-01" }, { licence_expiry: undefined }]) expect(stop(d)).toEqual([]);
  });
  test("the approval checklist shows a licence problem as blocked (no override)", () => {
    const src = readFileSync("src/lib/partner-activation.functions.ts", "utf8");
    const checklist = src.slice(src.indexOf("export const getApprovalChecklist"));
    expect(checklist).toMatch(/electricianLicenceBlockers\([^)]*\)\) items\.push\(\{ key: `licence:\$\{b\}`, kind: "fix"/);
  });
  test("REC number missing — or the host REC's number when they work under another REC", () => {
    expect(stop({ rec_registration_number: "" })).toEqual(["REC number is missing."]);
    expect(stop({ rec_registration_number: "", works_under_rec: true, host_rec_number: "999" })).toEqual([]);
    expect(stop({ rec_registration_number: "", works_under_rec: true, host_rec_number: "" })).toEqual(["REC number is missing."]);
  });
  test("cover under $5m stops; working under another REC skips the cover check", () => {
    expect(stop({ public_liability_cover_amount: 2_000_000 })).toEqual(["Public liability cover is under $5,000,000."]);
    expect(stop({ public_liability_cover_amount: null })).toEqual(["Public liability cover is under $5,000,000."]);
    expect(stop({ public_liability_cover_amount: null, works_under_rec: true, host_rec_number: "999" })).toEqual([]);
  });
  test("PIESA price over $349 inc GST stops; exactly $349 is fine", () => {
    expect(stop({ assessment_rate: 349 })).toEqual([]);
    expect(stop({ assessment_rate: 400 })).toEqual(["PIESA price $400 is over the $349 limit."]);
  });
  test("installers are not affected", () => {
    expect(activationBlockers("installer", { public_liability_expiry: "2099-01-01" } as never, "HI-VIC-A48-INST-1.13-2026-10-03", "2026-10-03", NOW)).toEqual([]);
  });
});
