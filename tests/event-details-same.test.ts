import { describe, expect, it } from "bun:test";
import { canonicalJson, sameEventDetails } from "../src/lib/event-details-same.core";

describe("sameEventDetails (Mitti sync duplicate guard)", () => {
  it("treats jsonb key-sorted details from the database as equal to freshly built details", () => {
    // Fresh object: insertion order as built in insulation-product.server.ts.
    const fresh = { audit_id: "audit_1", ready: true, product: { option: "Bradford Gold R5", rValue: 5 }, reasons: [], declared_not_verified: true };
    // What Postgres jsonb returns: keys sorted at every depth.
    const fromDb = { audit_id: "audit_1", declared_not_verified: true, product: { option: "Bradford Gold R5", rValue: 5 }, ready: true, reasons: [] };
    expect(sameEventDetails(fromDb, fresh)).toBe(true);
  });

  it("treats nested objects with different key order as equal (electrician notOnboarded)", () => {
    const fresh = { audit_id: "a", name: "TEST Sparky", notOnboarded: { name: "TEST Sparky", licence: "L1", email: null }, reasons: ["Electrician not onboarded: TEST Sparky"] };
    const fromDb = { audit_id: "a", name: "TEST Sparky", notOnboarded: { email: null, licence: "L1", name: "TEST Sparky" }, reasons: ["Electrician not onboarded: TEST Sparky"] };
    expect(sameEventDetails(fromDb, fresh)).toBe(true);
  });

  it("still records a real change (different product)", () => {
    const prev = { audit_id: "a", product: { option: "Bradford Gold R5" }, ready: true };
    const next = { audit_id: "a", product: { option: "Earthwool R6" }, ready: true };
    expect(sameEventDetails(prev, next)).toBe(false);
  });

  it("still records a real change (electrician name changes)", () => {
    const prev = { audit_id: "a", name: "Peter orlando", ready: false };
    const next = { audit_id: "a", name: "ORLANDO POWERED", ready: true };
    expect(sameEventDetails(prev, next)).toBe(false);
  });

  it("treats missing previous event as different (first record is kept)", () => {
    expect(sameEventDetails(null, { audit_id: "a", ready: true })).toBe(false);
    expect(sameEventDetails(undefined, { audit_id: "a", ready: true })).toBe(false);
  });

  it("ignores undefined fields the way jsonb storage drops them", () => {
    const fresh = { audit_id: "a", name: "x", extra: undefined };
    const fromDb = { audit_id: "a", name: "x" };
    expect(sameEventDetails(fromDb, fresh)).toBe(true);
  });

  it("canonicalJson sorts arrays of objects element-wise without reordering the array", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});
