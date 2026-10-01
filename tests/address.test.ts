import { expect, test } from "bun:test";

import {
  addressFromTyped,
  extractPostcode,
  formatAddress,
  mergeTypedNumber,
  parseNominatimSuggestions,
  suburbFromLine,
  type AddressSuggestion,
} from "../src/lib/address.core";

/** A row shaped like the address service's response. */
function row(address: Record<string, unknown>) {
  return { place_id: 1, lat: 0, lon: 0, addresstype: "road", name: "x", display_name: "x", address };
}

const VIC = { state: "Victoria", country: "Australia", countrycode: "au" };

test("formats parts the way we show them", () => {
  expect(
    formatAddress({ streetNumber: "34", street: "Watsons Road", suburb: "Bundoora", state: "VIC", postcode: "3757" }),
  ).toBe("34 Watsons Road, Bundoora VIC 3757");
});

test("formats a suburb-only row", () => {
  expect(formatAddress({ streetNumber: "", street: "", suburb: "Bundoora", state: "VIC", postcode: "3083" })).toBe(
    "Bundoora VIC 3083",
  );
});

test("pulls the postcode out of typed text", () => {
  expect(extractPostcode("8 Yarra Street, Richmond VIC 3121")).toBe("3121");
  expect(extractPostcode("34 Watsons Road")).toBe("");
  expect(extractPostcode("Unit 2/14 Smith Street 3065")).toBe("3065");
});

test("keeps Victorian rows with a street and a postcode", () => {
  const found = parseNominatimSuggestions(
    [row({ ...VIC, road: "Smith Street", suburb: "Fitzroy", postcode: "3065" })],
    "42 Smith Street Fitzroy",
  );
  expect(found).toHaveLength(1);
  expect(found[0].full).toBe("Smith Street, Fitzroy VIC 3065");
  expect(found[0].suburb).toBe("Fitzroy");
  expect(found[0].state).toBe("VIC");
});

test("drops rows from other states", () => {
  const found = parseNominatimSuggestions(
    [row({ state: "New South Wales", road: "Smith Street", suburb: "Sydney", postcode: "2000" })],
    "smith street",
  );
  expect(found).toEqual([]);
});

test("needs a suburb and a real postcode", () => {
  const found = parseNominatimSuggestions(
    [
      row({ ...VIC, road: "Smith Street", suburb: "Fitzroy", postcode: "30" }),
      row({ ...VIC, suburb: "Fitzroy", postcode: "3065", road: "" }),
      row({ ...VIC, road: "Smith Street", postcode: "3065", suburb: "" }),
    ],
    "smith street",
  );
  // A broken postcode and a street with no suburb are both useless to us — the
  // whole point of the search is that the suburb and postcode come out right.
  expect(found.map((s) => s.full)).toEqual(["Fitzroy VIC 3065"]);
});

test("uses the suburb field, not the city, so Bundoora never reads as Melbourne", () => {
  const found = parseNominatimSuggestions(
    [row({ ...VIC, road: "Plenty Road", suburb: "Bundoora", city: "Melbourne", postcode: "3083" })],
    "125 plenty road bundoora",
  );
  expect(found[0].full).toBe("Plenty Road, Bundoora VIC 3083");
});

test("only offers suggestions from the suburb that was typed", () => {
  const found = parseNominatimSuggestions(
    [
      row({ ...VIC, road: "Smith Street", suburb: "Fitzroy", postcode: "3065" }),
      row({ ...VIC, road: "Smith Street", suburb: "Collingwood", postcode: "3066" }),
      row({ ...VIC, road: "Little Smith Street", suburb: "Fitzroy", postcode: "3065" }),
    ],
    "42 Smith Street Fitzroy",
  );
  expect(found.map((s) => s.suburb)).toEqual(["Fitzroy", "Fitzroy"]);
});

test("keeps every suburb when none was typed", () => {
  const found = parseNominatimSuggestions(
    [
      row({ ...VIC, road: "Smith Street", suburb: "Fitzroy", postcode: "3065" }),
      row({ ...VIC, road: "Smith Street", suburb: "Collingwood", postcode: "3066" }),
    ],
    "12 smith street",
  );
  expect(found).toHaveLength(2);
});

test("removes duplicate suggestions and caps the list", () => {
  const many = Array.from({ length: 12 }, (_unused, i) =>
    row({ ...VIC, road: `Street ${i}`, suburb: "Fitzroy", postcode: "3065" }),
  );
  many.push(many[0]);
  const found = parseNominatimSuggestions(many, "fitzroy");
  expect(found.length).toBeLessThanOrEqual(6);
  expect(new Set(found.map((s) => s.full)).size).toBe(found.length);
});

test("ignores a response that isn't a list", () => {
  expect(parseNominatimSuggestions(undefined, "x")).toEqual([]);
  expect(parseNominatimSuggestions({ features: [] }, "x")).toEqual([]);
});

test("keeps the house number the person typed", () => {
  const suggestion: AddressSuggestion = {
    streetNumber: "",
    street: "Plenty Road",
    suburb: "Bundoora",
    state: "VIC",
    postcode: "3083",
    full: "Plenty Road, Bundoora VIC 3083",
    key: "k",
  };
  const merged = mergeTypedNumber("125 Plenty Road Bundoora", suggestion);
  expect(merged.full).toBe("125 Plenty Road, Bundoora VIC 3083");
  expect(merged.streetNumber).toBe("125");
});

test("keeps a flat/unit prefix the person typed", () => {
  const suggestion: AddressSuggestion = {
    streetNumber: "",
    street: "Smith Street",
    suburb: "Fitzroy",
    state: "VIC",
    postcode: "3065",
    full: "Smith Street, Fitzroy VIC 3065",
    key: "k",
  };
  expect(mergeTypedNumber("2a Smith Street Fitzroy", suggestion).streetNumber).toBe("2a");
});

test("leaves a suggestion alone when it already has a number, or none was typed", () => {
  const withNumber: AddressSuggestion = {
    streetNumber: "42",
    street: "Smith Street",
    suburb: "Fitzroy",
    state: "VIC",
    postcode: "3065",
    full: "42 Smith Street, Fitzroy VIC 3065",
    key: "k",
  };
  expect(mergeTypedNumber("42 Smith Street Fitzroy", withNumber)).toBe(withNumber);

  const noNumber: AddressSuggestion = {
    streetNumber: "",
    street: "Smith Street",
    suburb: "Fitzroy",
    state: "VIC",
    postcode: "3065",
    full: "Smith Street, Fitzroy VIC 3065",
    key: "k",
  };
  expect(mergeTypedNumber("Smith Street Fitzroy", noNumber)).toBe(noNumber);
});

test("keeps typed text and finds its postcode", () => {
  const typed = addressFromTyped("  9   Yarra Street   Richmond 3121 ");
  expect(typed.line).toBe("9 Yarra Street Richmond 3121");
  expect(typed.postcode).toBe("3121");
});

test("reads the suburb back out of a full address line", () => {
  expect(suburbFromLine("34 Watsons Road, Bundoora VIC 3757")).toBe("Bundoora");
  expect(suburbFromLine("34 Watsons Road, Bundoora 3757")).toBe("Bundoora");
  expect(suburbFromLine("34 Watsons Road")).toBe("");
});
