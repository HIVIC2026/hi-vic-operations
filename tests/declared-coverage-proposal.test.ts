import { describe, expect, test } from "bun:test";
import { proposeDeclaredCoverage } from "../src/lib/declared-coverage-proposal.core";

describe("office declared coverage proposals", () => {
  test("uses the origin postcode centroid and straight-line radius", () => {
    const proposal = proposeDeclaredCoverage("Frankston VIC 3199", 10);
    expect(proposal.reason).toBeNull();
    expect(proposal.postcodes).toContain("3199");
    expect(proposal.postcodes).toContain("3200");
    expect(proposal.postcodes).not.toContain("3000");
    const smaller = proposeDeclaredCoverage("Frankston VIC 3199", 1);
    expect(smaller.postcodes).toContain("3199");
    expect(smaller.postcodes).not.toContain("3200");
  });

  test("Anywhere in Victoria proposes the existing prefix wildcard only", () => {
    expect(proposeDeclaredCoverage(null, 9999).postcodes).toEqual(["3*"]);
  });

  test("non-3xxx centroids are skipped even when inside the radius", () => {
    const proposal = proposeDeclaredCoverage("Melbourne VIC 3000", 9000);
    expect(proposal.postcodes).toHaveLength(722);
    expect(proposal.postcodes).toContain("3000");
    expect(proposal.postcodes).not.toContain("8001");
    expect(proposal.postcodes).not.toContain("9999");
    expect(proposal.postcodes?.every((code) => /^3\d{3}$/.test(code))).toBe(true);
  });

  test("missing, unknown or non-Victorian origin postcode gives no proposal", () => {
    for (const origin of [null, "Frankston VIC", "Sydney NSW 2000", "Melbourne VIC 8001", "VIC 3999", "123199"]) {
      expect(proposeDeclaredCoverage(origin, 50)).toEqual({ postcodes: null, summary: null, reason: "No postcode in their address" });
    }
  });

  test("missing or invalid travel distance gives no proposal", () => {
    for (const radius of [null, undefined, 0, -1, NaN, Infinity]) {
      expect(proposeDeclaredCoverage("Frankston VIC 3199", radius)).toEqual({ postcodes: null, summary: null, reason: "No travel distance" });
    }
  });
});