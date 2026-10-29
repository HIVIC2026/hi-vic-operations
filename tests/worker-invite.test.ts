import { describe, expect, test } from "bun:test";
import { INVITE_DAYS, inviteExpiry, inviteState, workerDeclarations, workerSubmissionErrors } from "../src/lib/worker-invite.core";

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
  test("workers tick the customer-ownership box", () => {
    expect(workerDeclarations("electrician", "Acme").map((d) => d.key)).toContain("customer_owner");
  });
  test("sampleable declarations stay complete and trade-specific", () => {
    const electrician = workerDeclarations("electrician", "Acme");
    const installer = workerDeclarations("installer", "Acme");
    expect(electrician).toHaveLength(6);
    expect(installer).toHaveLength(6);
    expect(electrician.find((d) => d.key === "licence_current")?.text).toContain("electrician licence");
    expect(installer.find((d) => d.key === "licence_current")?.text).toContain("training");
  });
  test("submission validation", () => {
    const keys = workerDeclarations("electrician", "Acme").map((d) => d.key);
    const ok = { full_legal_name: "Sam Taylor", mobile: "0412 345 678", email: "sam@x.com", licence_number: "A123", accepted: keys, signed_name: "Sam Taylor" };
    expect(workerSubmissionErrors("electrician", ok, keys)).toEqual([]);
    expect(workerSubmissionErrors("electrician", { ...ok, licence_number: "" }, keys).length).toBe(1);
    expect(workerSubmissionErrors("electrician", { ...ok, accepted: keys.slice(1) }, keys)).toContain("Tick every box before signing.");
    expect(workerSubmissionErrors("installer", { ...ok, licence_number: "" }, keys)).toContain("Enter your training or qualification (e.g. Cert III, or 'Experienced installer').");
  });
});
