import { expect, test } from "bun:test";
import { DETAILS_PROBLEM_LABEL, hasCaseProblem, splitAddress, tidyEnquiryDetails, tidyPersonName } from "../src/lib/name-address-tidy.core";

// Decision 216/238: capitalisation tidied automatically; addresses split into street / suburb / postcode for every source.
// Decision 281: names are never a "problem" (first-name-only, odd or missing is tidied and stored as it is);
// what the split cannot read is filled by the address lookup, not an office button.
test("capitalisation tidy fixes ALL CAPS and all lower case, keeps mixed case", () => {
  expect(tidyPersonName("MARGARET DOYLE")).toBe("Margaret Doyle");
  expect(tidyPersonName("siobhan  brennan")).toBe("Siobhan Brennan");
  expect(tidyPersonName("o'connell mary")).toBe("O'Connell Mary");
  expect(tidyPersonName("john mcdonald")).toBe("John McDonald");
  expect(tidyPersonName("anne-marie smith-jones")).toBe("Anne-Marie Smith-Jones");
  expect(tidyPersonName("ludwig van beethoven")).toBe("Ludwig van Beethoven");
  expect(tidyPersonName("Jo McTavish")).toBe("Jo McTavish"); // already mixed: untouched
  expect(hasCaseProblem("ABC Smith")).toBe(false);
  expect(hasCaseProblem("abc smith")).toBe(true);
});

test("decision 281: first-name-only, odd and missing names are tidied to what they are and block nothing", () => {
  expect(tidyPersonName("jo")).toBe("Jo");
  expect(tidyPersonName("asdf")).toBe("Asdf");
  expect(tidyPersonName("")).toBe("");
  expect(tidyPersonName(null)).toBe("");
  for (const name of ["jo", "Nguyen", "asdf", "test test", "", null]) {
    const t = tidyEnquiryDetails({ fullName: name, addressLine: "3 Lakeview Drive", suburb: "Lilydale", postcode: "3140" });
    expect(t.problems).toEqual([]);
  }
  expect(Object.keys(DETAILS_PROBLEM_LABEL)).toEqual(["street_missing", "suburb_missing", "postcode_missing"]); // address only
});

test("address split handles commas, VIC and postcodes, and one-line website addresses", () => {
  expect(splitAddress("8 Carrington Rd, Box Hill 3128")).toEqual({ street: "8 Carrington Rd", suburb: "Box Hill", postcode: "3128", state: "VIC" });
  expect(splitAddress("27 Hanover Road, Vermont South VIC 3133")).toEqual({ street: "27 Hanover Road", suburb: "Vermont South", postcode: "3133", state: "VIC" });
  expect(splitAddress("12 wattle st clayton")).toEqual({ street: "12 Wattle St", suburb: "Clayton", postcode: "", state: "VIC" });
  expect(splitAddress("15 Lum Road Wheelers Hill 3150")).toEqual({ street: "15 Lum Road", suburb: "Wheelers Hill", postcode: "3150", state: "VIC" });
  // Already split: stored suburb wins and is stripped from the line.
  expect(splitAddress("41 Burwood Highway, Burwood East", "Burwood East", "3151")).toEqual({ street: "41 Burwood Highway", suburb: "Burwood East", postcode: "3151", state: "VIC" });
  // Cannot split: suburb stays blank (never invented) — the lookup fills it (decision 281).
  expect(splitAddress("unit 3/22 High Street Road").suburb).toBe("");
});

test("the tidy reports only what the address is still missing after it", () => {
  const caseOnly = tidyEnquiryDetails({ fullName: "MARGARET DOYLE", addressLine: "8 Carrington Rd, Box Hill 3128", suburb: null, postcode: null });
  expect(caseOnly.problems).toEqual([]);
  expect(caseOnly.changed).toBe(true);
  expect(caseOnly.fullName).toBe("Margaret Doyle");
  expect(tidyEnquiryDetails({ fullName: "jo", addressLine: "12 wattle st clayton", suburb: null, postcode: null }).problems).toEqual(["postcode_missing"]);
  expect(tidyEnquiryDetails({ fullName: "Aisha Karim", addressLine: "unit 3/22 High Street Road", suburb: null, postcode: null }).problems).toEqual(["suburb_missing", "postcode_missing"]);
  expect(tidyEnquiryDetails({ fullName: "x", addressLine: "", suburb: null, postcode: null }).problems).toEqual(["street_missing", "suburb_missing", "postcode_missing"]);
  expect(tidyEnquiryDetails({ fullName: "Ruth Mackenzie", addressLine: "41 Burwood Highway", suburb: "Burwood East", postcode: "3151" })).toMatchObject({ problems: [], changed: false });
});
