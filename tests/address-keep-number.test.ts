import { describe, expect, test } from "bun:test";
import { keepPickedNumber, type ResolvedAddress } from "../src/lib/rec-onboarding.core";
const d = (label: string, street: string | null): ResolvedAddress => ({ label, street, suburb: "X", postcode: "3068", state: "VIC", country: "AU", provider: "google_places_au" });
describe("keepPickedNumber", () => {
  test("restores unit/street number dropped by lookup", () => {
    const r = keepPickedNumber("3/12 Smith St, Fitzroy North VIC", d("Smith St, Fitzroy North VIC 3068", "Smith Street"));
    expect(r.label).toBe("3/12 Smith St, Fitzroy North VIC 3068");
    expect(r.street).toBe("3/12 Smith Street");
  });
  test("restores plain number", () => {
    expect(keepPickedNumber("15 Main Street, Golden Point Ballarat, VIC", d("Main St, Golden Point VIC 3350", "Main Street")).label).toBe("15 Main St, Golden Point VIC 3350");
  });
  test("leaves complete details unchanged", () => {
    const x = d("10 Collins St, Melbourne VIC 3000", "10 Collins Street");
    expect(keepPickedNumber("10 Collins St, Melbourne VIC", x)).toBe(x);
  });
  test("never adds non-number text", () => {
    const x = d("Smith St, Fitzroy VIC 3065", "Smith Street");
    expect(keepPickedNumber("Melbourne Uni Smith St, Fitzroy VIC", x)).toBe(x);
  });
});
