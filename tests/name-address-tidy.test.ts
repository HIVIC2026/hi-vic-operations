import { expect, test } from "bun:test";
import { fixDetailsErrors, hasCaseProblem, nameProblem, needsFixDetails, splitAddress, tidyEnquiryDetails, tidyPersonName } from "../src/lib/name-address-tidy.core";

// Decision 216/238: capitalisation tidied automatically; addresses split into street / suburb / postcode for every source.
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

test("one-word and junk names go to Fix details", () => {
  expect(nameProblem("jo")).toBe("one_word");
  expect(nameProblem("Nguyen")).toBe("one_word");
  expect(nameProblem("asdf")).toBe("junk");
  expect(nameProblem("test test")).toBe("junk");
  expect(nameProblem("jo@example.com")).toBe("junk");
  expect(nameProblem("xxx yyy")).toBe("junk");
  expect(nameProblem("")).toBe("missing");
  expect(nameProblem("Jo Tran")).toBeNull();
});

test("address split handles commas, VIC and postcodes, and one-line website addresses", () => {
  expect(splitAddress("8 Carrington Rd, Box Hill 3128")).toEqual({ street: "8 Carrington Rd", suburb: "Box Hill", postcode: "3128", state: "VIC" });
  expect(splitAddress("27 Hanover Road, Vermont South VIC 3133")).toEqual({ street: "27 Hanover Road", suburb: "Vermont South", postcode: "3133", state: "VIC" });
  expect(splitAddress("12 wattle st clayton")).toEqual({ street: "12 Wattle St", suburb: "Clayton", postcode: "", state: "VIC" });
  expect(splitAddress("15 Lum Road Wheelers Hill 3150")).toEqual({ street: "15 Lum Road", suburb: "Wheelers Hill", postcode: "3150", state: "VIC" });
  // Already split: stored suburb wins and is stripped from the line.
  expect(splitAddress("41 Burwood Highway, Burwood East", "Burwood East", "3151")).toEqual({ street: "41 Burwood Highway", suburb: "Burwood East", postcode: "3151", state: "VIC" });
  // Cannot split: suburb stays blank (never invented).
  expect(splitAddress("unit 3/22 High Street Road").suburb).toBe("");
});

test("Fix details only holds what the tidy cannot fix", () => {
  const caseOnly = tidyEnquiryDetails({ fullName: "MARGARET DOYLE", addressLine: "8 Carrington Rd, Box Hill 3128", suburb: null, postcode: null });
  expect(caseOnly.problems).toEqual([]);
  expect(caseOnly.changed).toBe(true);
  expect(caseOnly.fullName).toBe("Margaret Doyle");
  expect(needsFixDetails({ fullName: "jo", addressLine: "12 wattle st clayton", suburb: null, postcode: null })).toBe(true);
  expect(tidyEnquiryDetails({ fullName: "jo", addressLine: "12 wattle st clayton", suburb: null, postcode: null }).problems).toEqual(["name_one_word", "postcode_missing"]);
  expect(needsFixDetails({ fullName: "Ruth Mackenzie", addressLine: "41 Burwood Highway", suburb: "Burwood East", postcode: "3151" })).toBe(false);
  expect(tidyEnquiryDetails({ fullName: "Ruth Mackenzie", addressLine: "41 Burwood Highway", suburb: "Burwood East", postcode: "3151" }).changed).toBe(false);
});

test("office save validates after the tidy", () => {
  expect(fixDetailsErrors({ fullName: "Jo Tran", street: "12 Wattle Street", suburb: "Clayton", postcode: "3168" })).toEqual([]);
  expect(fixDetailsErrors({ fullName: "Jo", street: "12 Wattle Street", suburb: "", postcode: "31" })).toEqual(["First name only", "Suburb not split", "No postcode"]);
});
