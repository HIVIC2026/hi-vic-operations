import { describe, expect, test } from "bun:test";
import { ciiSummary, partnerIssues } from "../src/lib/partner.core";

const base = { enquiry_type: "installer", phone: "0400000000", service_areas: ["Bundoora"], estimated_r5_install_rate_per_sqm_inc_gst: 27 };
describe("installer CII on the approvals list", () => {
  test("signed onboarding uses per-person CII, not the empty business field", () => {
    const r = { ...base, cii_certification_status: null, raw_payload: { installers: [{ name: "A", cii_holds: "held" }, { name: "B", cii_holds: "in_training" }] } };
    expect(ciiSummary(r)).toBe("1 of 2 installers certified");
    const issues = partnerIssues(r);
    expect(issues).toContain("1 of 2 installers not CII certified yet");
    expect(issues).not.toContain("CII certification status not supplied");
  });
  test("all certified raises no CII flag", () => {
    const r = { ...base, cii_certification_status: null, raw_payload: { installers: [{ name: "A", cii_holds: "held" }] } };
    expect(ciiSummary(r)).toBe("1 of 1 installer certified");
    expect(partnerIssues(r).some((i) => i.includes("CII"))).toBe(false);
  });
  test("website enquiries keep the business-level field", () => {
    expect(ciiSummary({ cii_certification_status: "certified", raw_payload: {} })).toBe("certified");
    expect(partnerIssues({ ...base, cii_certification_status: null, raw_payload: {} })).toContain("CII certification status not supplied");
  });
});
