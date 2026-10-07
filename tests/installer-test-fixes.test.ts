import { describe, expect, test } from "bun:test";
import { payPill, payState } from "../src/lib/trade-view.core";
import { cleanLead, emailDomainTypo } from "../src/lib/bulk-import.core";

describe("installer test fixes (7 Oct)", () => {
  test("payout clock starts at the LATER of AP approval and owner paid in full", () => {
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: null })).toEqual({ kind: "checking" });
    expect(payPill(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: "2026-10-03T00:00:00Z" })).label).toBe("Coming Sat 10 Oct");
    expect(payPill(payState({ paidAt: null, apApprovedAt: "2026-10-03T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: "2026-10-01T00:00:00Z" })).label).toBe("Coming Sat 10 Oct");
    expect(payState({ paidAt: null, apApprovedAt: null, installerSupplied: true, ownerPaidInFullAt: "2026-10-01T00:00:00Z" })).toEqual({ kind: "checking" });
  });
  test("misspelt email domains are flagged, real ones are not", () => {
    expect(emailDomainTypo("a@gmai.com")).toBe("gmail.com");
    expect(emailDomainTypo("a@gmail.com")).toBeNull();
    const { issues } = cleanLead({ full_name: "A", phone: "0412345678", email: "a@gmai.com", postcode: "3336" } as never);
    expect(issues.some((i) => i.includes("did you mean gmail.com"))).toBe(true);
  });
});

describe("Money pay date: HIV leads vs installer-supplied jobs", () => {
  test("HIV lead: 7 days after HIV approval, owner payment not needed", () => {
    expect(payPill(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false, ownerPaidInFullAt: null })).label).toBe("Coming Thu 8 Oct");
  });
  test("installer-supplied: waits for owner paid in full, then 7 days after the later", () => {
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: null })).toEqual({ kind: "checking" });
    expect(payPill(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: "2026-10-03T00:00:00Z" })).label).toBe("Coming Sat 10 Oct");
  });
});
