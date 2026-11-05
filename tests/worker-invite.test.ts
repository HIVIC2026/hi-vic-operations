import { describe, expect, test } from "bun:test";
import { INVITE_DAYS, inviteExpiry, inviteState, workerSubmissionErrors } from "../src/lib/worker-invite.core";

describe("worker invites", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  test("expires after 14 days", () => {
    expect(INVITE_DAYS).toBe(14);
    expect(inviteExpiry(now)).toBe("2026-10-15T00:00:00.000Z");
  });
  test("state", () => {
    const base = { expires_at: inviteExpiry(now), used_at: null, revoked_at: null };
    expect(inviteState(base, now)).toBe("active");
    expect(inviteState(base, now + 15 * 86_400_000)).toBe("expired");
    expect(inviteState({ ...base, used_at: "x" }, now)).toBe("used");
    expect(inviteState({ ...base, revoked_at: "x", used_at: "x" }, now)).toBe("revoked");
  });
  test("submission validation", () => {
    // Jo 5 Nov 2026: details only, no ticks and no signature.
    const ok = { full_legal_name: "Sam Taylor", mobile: "0412 345 678", email: "sam@x.com", licence_number: "A123" };
    expect(workerSubmissionErrors("electrician", ok)).toEqual([]);
    expect(workerSubmissionErrors("electrician", { ...ok, licence_number: "" }).length).toBe(1);
    expect(workerSubmissionErrors("installer", { ...ok, licence_number: "" })).toContain("Enter your training or qualification (e.g. Cert III, or 'Experienced installer').");
  });
});
