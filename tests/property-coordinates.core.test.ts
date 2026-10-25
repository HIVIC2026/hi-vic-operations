// Night run 25 Oct 2026: the photo location check fills a missing property point from the address search — only when the
// looked-up place is the same address (postcode + suburb), never a guess.
import { describe, expect, test } from "bun:test";
import { coordinatesFromLookup, propertySearchText } from "../src/lib/property-coordinates.core";

const P = { address_line: "824 High Street Road", suburb: "Glen Waverley", state: "VIC", postcode: "3150" };
const D = { label: "824 High Street Rd, Glen Waverley VIC 3150", suburb: "Glen Waverley", postcode: "3150", latitude: -37.8746, longitude: 145.2216 };

describe("property coordinates from the address search", () => {
  test("search text needs a street line and a 4-digit postcode", () => {
    expect(propertySearchText(P)).toBe("824 High Street Road, Glen Waverley VIC 3150");
    expect(propertySearchText({ ...P, postcode: null })).toBeNull();
    expect(propertySearchText({ ...P, address_line: " " })).toBeNull();
  });
  test("same postcode and suburb → [lng, lat]", () => expect(coordinatesFromLookup(P, D)).toEqual([145.2216, -37.8746]));
  test("different postcode or suburb → null (never a guessed point)", () => {
    expect(coordinatesFromLookup(P, { ...D, postcode: "3149" })).toBeNull();
    expect(coordinatesFromLookup(P, { ...D, suburb: "Mount Waverley" })).toBeNull();
  });
  test("missing or impossible coordinates → null", () => {
    expect(coordinatesFromLookup(P, { ...D, latitude: null })).toBeNull();
    expect(coordinatesFromLookup(P, { ...D, latitude: 51.5, longitude: -0.1 })).toBeNull();
    expect(coordinatesFromLookup(P, null)).toBeNull();
  });
});
