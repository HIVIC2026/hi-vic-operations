import { describe, expect, test } from "bun:test";
import { assignBlocker, hashToken, isTokenShape, linkState, needsReapproval, newToken, senderLabel } from "../src/lib/worker-links.core";

describe("worker links", () => {
  test("tokens are unique, well-shaped and hashed deterministically", async () => {
    const a = newToken(), b = newToken();
    expect(a).not.toBe(b);
    expect(isTokenShape(a)).toBe(true);
    expect(isTokenShape("short")).toBe(false);
    expect(await hashToken(a)).toBe(await hashToken(a));
    expect((await hashToken(a)).length).toBe(64);
  });
  test("link state", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    expect(linkState({ revoked_at: null, expires_at: "2026-10-05T00:00:00Z" }, now)).toBe("active");
    expect(linkState({ revoked_at: null, expires_at: "2026-09-30T00:00:00Z" }, now)).toBe("expired");
    expect(linkState({ revoked_at: "2026-09-30T00:00:00Z", expires_at: "2026-10-05T00:00:00Z" }, now)).toBe("revoked");
  });
  test("only approved, current workers of an assigned company get links", () => {
    const w = { approval_status: "approved", removed_at: null, business_id: "b1" };
    expect(assignBlocker(w, ["b1"])).toBeNull();
    expect(assignBlocker({ ...w, approval_status: "pending" }, ["b1"])).toMatch(/approval/);
    expect(assignBlocker({ ...w, approval_status: "rejected" }, ["b1"])).toMatch(/approved/);
    expect(assignBlocker({ ...w, removed_at: "x" }, ["b1"])).toMatch(/removed/);
    expect(assignBlocker(w, ["b2"])).toMatch(/isn't assigned/);
  });
  test("identity/licence edits need re-approval; contact edits don't", () => {
    expect(needsReapproval({ licence_number: "A1", mobile: "1" }, { licence_number: "A2" })).toBe(true);
    expect(needsReapproval({ licence_number: "A1", mobile: "1" }, { mobile: "2" })).toBe(false);
  });
  test("sender label names worker and company", () => {
    expect(senderLabel("Sam Taylor", "Sparky Electrical")).toBe("Sam Taylor — Sparky Electrical");
  });
});
