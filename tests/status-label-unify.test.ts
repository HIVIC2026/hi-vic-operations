// P1-R2-S05 — GAP-03: Leads/Office status display-label unification (presentation only).
// Verifies the shared enquiry-stage vocabulary stays consistent across Leads (STATUS_LABEL)
// and the Office pipeline (OFFICE_STATUSES "enquiry.*"), that unknown statuses fail safe, that
// the enquiryStatus() workflow logic is unchanged, and that no two distinct statuses collapse
// to one label. Reads real exports; changes no database value and no workflow transition.
import { describe, expect, test } from "bun:test";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  statusLabel,
  enquiryStatus,
  type EnquiryStatus,
} from "../src/lib/enquiry-groups.core";
import { OFFICE_STATUSES } from "../src/lib/office-status.core";

describe("GAP-03 Leads/Office status label unification", () => {
  // The same underlying enquiry fact must read the same on both screens.
  const EQUIVALENCE: Array<[EnquiryStatus, keyof typeof OFFICE_STATUSES]> = [
    ["spot_saved", "enquiry.spot_saved"],
    ["offered_spot", "enquiry.estimate_sent"],
    ["insulation_requested", "enquiry.video_asked"],
  ];

  test.each(EQUIVALENCE)("Leads %s shows the same label as the Office pipeline", (leads, office) => {
    expect(STATUS_LABEL[leads]).toBe(OFFICE_STATUSES[office].label);
  });

  test("unknown / null / undefined status fails safe to 'Needs attention'", () => {
    expect(statusLabel("totally_unknown")).toBe("Needs attention");
    expect(statusLabel(null)).toBe("Needs attention");
    expect(statusLabel(undefined)).toBe("Needs attention");
    expect(statusLabel("")).toBe("Needs attention");
  });

  test("every known status resolves to its own mapped label", () => {
    for (const s of STATUS_ORDER) expect(statusLabel(s)).toBe(STATUS_LABEL[s]);
  });

  test("no two distinct statuses are incorrectly merged into one label", () => {
    const labels = STATUS_ORDER.map((s) => STATUS_LABEL[s]);
    expect(new Set(labels).size).toBe(STATUS_ORDER.length);
  });

  // The fix is presentation-only: the status-selection logic must be byte-for-byte unchanged.
  const b = {
    spotSaved: false, ineligible: false, ineligibleEmailSent: false,
    campaignSent: false, insulationEmailSent: false, campaignGroup: null as "likely" | "onsite" | null,
  };
  test("workflow transitions unchanged: spot saved wins", () =>
    expect(enquiryStatus({ ...b, spotSaved: true })).toBe("spot_saved"));
  test("workflow transitions unchanged: ineligible needs the email", () => {
    expect(enquiryStatus({ ...b, ineligible: true, ineligibleEmailSent: false })).toBe("needs_attention");
    expect(enquiryStatus({ ...b, ineligible: true, ineligibleEmailSent: true })).toBe("ineligible");
  });
  test("workflow transitions unchanged: onsite campaign -> insulation requested", () =>
    expect(enquiryStatus({ ...b, campaignSent: true, campaignGroup: "onsite" })).toBe("insulation_requested"));
  test("workflow transitions unchanged: likely campaign -> offered spot", () =>
    expect(enquiryStatus({ ...b, campaignSent: true, campaignGroup: "likely" })).toBe("offered_spot"));
  test("workflow transitions unchanged: nothing sent -> needs attention", () =>
    expect(enquiryStatus(b)).toBe("needs_attention"));
});
