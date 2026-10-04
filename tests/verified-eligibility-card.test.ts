import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assessEligibility,
  electricalSummary,
  evidenceSummary,
  readyCheckPresent,
  type ReadyCheckEvidence,
} from "../src/lib/verified-eligibility.core";

const ev = (o: Partial<ReadyCheckEvidence> = {}): ReadyCheckEvidence => ({
  readyCheck: { ref: "rc1", version: 1, final: true, submissionRef: "m1" },
  currentVersion: 1,
  attendance: { installer: true, attendedAt: true, geotagPhoto: true, ceilingMedia: true },
  measure: { areaM2: 120, method: "tape" },
  insulation: { existing: "none", type: null, depthMm: null, rValue: null, photos: false },
  removal: "no",
  access: { level: "standard", evidence: true },
  electrical: { downlightCount: 4, downlightType: "led" },
  conflicts: [],
  priorActivity: "none_known",
  ...o,
});

describe("verified eligibility office card", () => {
  test("hidden when no Ready Check exists", () => {
    expect(
      readyCheckPresent(
        ev({ readyCheck: { ref: null, version: null, final: false, submissionRef: null } }),
      ),
    ).toBe(false);
    expect(readyCheckPresent(ev())).toBe(true);
  });
  test("summary lists every property-eligibility item and excludes Section D", () => {
    const labels = evidenceSummary(
      ev({
        insulation: { existing: "present", type: "batts", depthMm: 50, rValue: 1.5, photos: true },
      }),
    ).map((r) => r.label);
    for (const l of [
      "Attendance / time",
      "Geotagged attendance photo",
      "Ceiling-space media",
      "Measured ceiling area",
      "Measurement method",
      "Existing insulation",
      "Insulation type",
      "Depth / R-value",
      "Insulation photos",
      "Removal",
      "Access / site",
    ])
      expect(labels).toContain(l);
    expect(labels.some((l) => /downlight/i.test(l))).toBe(false);
    expect(electricalSummary(ev()).map((r) => r.label)).toEqual([
      "Downlight count",
      "Downlight type",
    ]);
  });
  test("missing evidence shows red and disables eligible", () => {
    const e = ev({ measure: { areaM2: null, method: null } });
    expect(evidenceSummary(e).find((r) => r.label === "Measured ceiling area")!.ok).toBe(false);
    expect(assessEligibility(e).eligibleAllowed).toBe(false);
  });
  test("Section D unclear flags only, does not block eligible", () => {
    const a = assessEligibility(
      ev({ electrical: { downlightCount: null, downlightType: "unable_to_confirm" } }),
    );
    expect(a.flags.length).toBeGreaterThan(0);
    expect(a.eligibleAllowed).toBe(true);
  });
  test("card has no stage, quote, PIESA, invoice or message calls", () => {
    const src = readFileSync("src/components/portal/verified-eligibility.tsx", "utf8");
    for (const bad of [
      /advanceStage|moveStage/,
      /createQuote/,
      /requestPiesa/i,
      /createInvoice/i,
      /sendEmail|sendSms/i,
    ])
      expect(bad.test(src)).toBe(false);
  });
});
