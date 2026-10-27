// Phase 3 path 4 (Jo 27 Oct 2026): an expired trade document stops new offers with a plain reason naming the document;
// the uploaded renewal (same document, later date) lets work carry on.
import { describe, expect, test } from "bun:test";
import { lapsedCriticalCredentials, partnerWorkBlocker } from "../src/lib/pilot.core";
import { recEligibilityBlocker } from "../src/lib/allocation.core";

const now = new Date("2026-10-28T02:00:00Z");
const pl = (expires_at: string, label = "Public liability") => ({ kind: "public_liability_insurance", label, expires_at, critical: true, verification: "verified" });
const biz = { is_active: true, onboarding_status: "approved" } as never;

describe("expired document and its renewal", () => {
  test("expired, no renewal → blocked, naming the document", () => {
    expect(partnerWorkBlocker(biz, [pl("2026-10-26")], now)).toBe("Expired: Public liability. Upload a current document.");
  });
  test("expired + current renewal of the same document → not blocked", () => {
    expect(lapsedCriticalCredentials([pl("2026-10-26"), pl("2027-10-28", "Public liability (renewal)")], now)).toEqual([]);
    expect(partnerWorkBlocker(biz, [pl("2026-10-26"), pl("2027-10-28", "Public liability (renewal)")], now)).toBeNull();
  });
  test("a renewal for a different person does not clear another person's lapsed licence", () => {
    const a = { kind: "electrical_licence", label: "Licence A", expires_at: "2026-10-26", critical: true, verification: "verified", profile_id: "A" };
    const b = { ...a, label: "Licence B", expires_at: "2027-10-26", profile_id: "B" };
    expect(lapsedCriticalCredentials([a, b], now).map((c) => c.label)).toEqual(["Licence A"]);
  });
  test("refusal uses the specific reason when given", () => {
    const c = { is_active: true, onboarding_status: "approved", coverage_verified: true, covers_postcode: true, has_valid_licence: false, licence_blocker: "Public liability insurance expired on 2026-10-26. No new jobs until the renewed document is uploaded.", approved_workers: 1 } as never;
    expect(recEligibilityBlocker(c)).toBe("Public liability insurance expired on 2026-10-26. No new jobs until the renewed document is uploaded.");
  });
});
